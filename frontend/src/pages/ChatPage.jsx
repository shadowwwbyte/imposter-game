import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Send, Mic, MicOff, Reply, X, Smile } from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const REACTIONS = ['👍','❤️','😂','😮','😢','🔥','🎮','🕵️'];

export default function ChatPage() {
  const { userId: paramUserId } = useParams();
  const { user } = useAuthStore();
  const { getSocket } = useSocketStore();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeUserId, setActiveUserId] = useState(paramUserId || null);
  const [activeUser, setActiveUser] = useState(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [showReactions, setShowReactions] = useState(null);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const fetchConversations = async () => {
    try {
      const { data } = await api.get('/chat/conversations');
      setConversations(data);
    } catch {}
  };

  const fetchMessages = async (uid) => {
    try {
      const { data } = await api.get(`/chat/messages/${uid}`);
      setMessages(data);
      setTimeout(scrollToBottom, 100);
    } catch {}
  };

  const fetchUser = async (uid) => {
    try {
      const { data } = await api.get(`/users/${uid}`).catch(() => api.get(`/chat/conversations`));
      // Find from conversations
      const conv = conversations.find(c => c.other_user_id === uid);
      if (conv) setActiveUser({ id: uid, username: conv.username, avatar_color: conv.avatar_color, status: conv.status });
    } catch {}
  };

  useEffect(() => { fetchConversations(); }, []);

  useEffect(() => {
    if (paramUserId) {
      setActiveUserId(paramUserId);
    }
  }, [paramUserId]);

  useEffect(() => {
    if (activeUserId) {
      fetchMessages(activeUserId);
      fetchUser(activeUserId);
    }
  }, [activeUserId]);

  // Socket events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onMessage = (msg) => {
      const isRelevant = msg.sender_id === activeUserId || msg.receiver_id === activeUserId ||
                         msg.sender_id === user.id || msg.receiver_id === user.id;
      if (isRelevant && (msg.sender_id === activeUserId || msg.receiver_id === activeUserId)) {
        setMessages(m => [...m, msg]);
        setTimeout(scrollToBottom, 50);
      }
      fetchConversations();
    };

    const onReaction = ({ messageId, reactions }) => {
      setMessages(m => m.map(msg => msg.id === messageId ? { ...msg, reactions } : msg));
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:reaction', onReaction);
    return () => { socket.off('chat:message', onMessage); socket.off('chat:reaction', onReaction); };
  }, [getSocket, activeUserId, user.id]);

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!text.trim() || !activeUserId) return;

    try {
      await api.post('/chat/messages', {
        receiverId: activeUserId,
        content: text.trim(),
        replyToId: replyTo?.id,
      });
      setText('');
      setReplyTo(null);
    } catch {
      toast.error('Failed to send message');
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        // In production: upload to S3/storage, get URL, then send
        const audioUrl = URL.createObjectURL(blob);
        await api.post('/chat/messages', {
          receiverId: activeUserId,
          messageType: 'audio',
          audioUrl,
          content: '🎙️ Audio message',
        });
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setRecording(true);
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const addReaction = async (messageId, emoji) => {
    try {
      await api.post(`/chat/messages/${messageId}/react`, { emoji });
      setShowReactions(null);
    } catch {}
  };

  const searchUsers = async (q) => {
    setSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    try {
      const { data } = await api.get(`/chat/search?q=${q}`);
      setSearchResults(data);
    } catch {}
  };

  const openChat = (uid, uname, color, status) => {
    setActiveUserId(uid);
    setActiveUser({ id: uid, username: uname, avatar_color: color, status });
    navigate(`/chat/${uid}`);
    setSearch('');
    setSearchResults([]);
  };

  return (
    <div className="h-full flex" style={{ color: 'var(--fg)' }}>
      {/* Sidebar */}
      <div className="w-64 flex flex-col shrink-0" style={{ background: 'var(--bg1)', borderRight: '1px solid var(--bg3)' }}>
        <div className="p-4">
          <h1 className="font-display text-2xl mb-3" style={{ color: 'var(--yellow-b, #fabd2f)' }}>CHAT</h1>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg3)' }} />
            <input
              value={search}
              onChange={e => searchUsers(e.target.value)}
              placeholder="Search users..."
              className="grv-input w-full pl-8 pr-3 py-2 rounded text-xs"
            />
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 rounded overflow-hidden" style={{ background: 'var(--bg2)', border: '1px solid var(--bg3)' }}>
              {searchResults.map(u => (
                <button key={u.id} onClick={() => openChat(u.id, u.username, u.avatar_color, u.status)}
                  className="w-full flex items-center gap-2 p-2 hover:bg-grv-bg3 transition-colors text-left text-xs">
                  <div className="w-7 h-7 rounded flex items-center justify-center font-bold text-xs"
                    style={{ background: u.avatar_color || '#458588', color: '#282828' }}>
                    {u.username[0].toUpperCase()}
                  </div>
                  {u.username}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.map(conv => (
            <button
              key={conv.other_user_id}
              onClick={() => openChat(conv.other_user_id, conv.username, conv.avatar_color, conv.status)}
              className={clsx('w-full flex items-center gap-3 p-3 transition-colors text-left', {
                'bg-grv-bg2': activeUserId === conv.other_user_id,
                'hover:bg-grv-bg2': activeUserId !== conv.other_user_id,
              })}
            >
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs"
                  style={{ background: conv.avatar_color || '#458588', color: '#282828' }}>
                  {conv.username?.[0]?.toUpperCase()}
                </div>
                {conv.unread_count > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold"
                    style={{ background: 'var(--red)', color: 'var(--fg)' }}>
                    {conv.unread_count}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs">{conv.username}</div>
                <div className="text-xs truncate" style={{ color: 'var(--fg3)' }}>
                  {conv.sender_id === user.id ? 'You: ' : ''}{conv.content?.substring(0, 30)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {activeUser ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--bg3)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm"
                style={{ background: activeUser.avatar_color || '#458588', color: '#282828' }}>
                {activeUser.username?.[0]?.toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-sm">{activeUser.username}</div>
                <div className="text-xs" style={{ color: 'var(--fg3)' }}>{activeUser.status || 'offline'}</div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map(msg => {
                const isMe = msg.sender_id === user.id;
                return (
                  <div key={msg.id} className={clsx('flex gap-2 group', { 'flex-row-reverse': isMe })}>
                    {!isMe && (
                      <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold shrink-0 mt-1"
                        style={{ background: activeUser.avatar_color, color: '#282828' }}>
                        {activeUser.username?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="max-w-xs">
                      {msg.reply_to_id && (
                        <div className="text-xs mb-1 px-2 py-1 rounded border-l-2 opacity-70"
                          style={{ borderColor: 'var(--blue)', background: 'var(--bg2)', color: 'var(--fg3)' }}>
                          ↩ {msg.reply_content?.substring(0, 50)}
                        </div>
                      )}
                      <div
                        className="px-3 py-2 rounded-lg text-sm relative"
                        style={{
                          background: isMe ? 'var(--blue)' : 'var(--bg2)',
                          color: 'var(--fg)',
                        }}
                      >
                        {msg.message_type === 'audio' ? (
                          <audio controls src={msg.audio_url} className="max-w-full" style={{ height: 32 }} />
                        ) : (
                          <span style={{ wordBreak: 'break-word' }}>{msg.content}</span>
                        )}

                        {/* Reactions */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(msg.reactions).map(([emoji, users]) => (
                              <span key={emoji} className="text-xs px-1 rounded cursor-pointer"
                                style={{ background: 'var(--bg3)' }}
                                onClick={() => addReaction(msg.id, emoji)}>
                                {emoji} {users.length}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="text-xs mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2"
                        style={{ color: 'var(--fg3)', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        <button onClick={() => setReplyTo(msg)} className="hover:underline">reply</button>
                        <button onClick={() => setShowReactions(showReactions === msg.id ? null : msg.id)}><Smile size={12} /></button>
                      </div>

                      {/* Reaction picker */}
                      {showReactions === msg.id && (
                        <div className="flex gap-1 mt-1 p-2 rounded" style={{ background: 'var(--bg2)', border: '1px solid var(--bg3)' }}>
                          {REACTIONS.map(e => (
                            <button key={e} onClick={() => addReaction(msg.id, e)} className="text-lg hover:scale-125 transition-transform">
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply banner */}
            {replyTo && (
              <div className="mx-4 mb-1 px-3 py-2 rounded flex items-center justify-between text-xs"
                style={{ background: 'var(--bg2)', border: '1px solid var(--blue)', color: 'var(--fg3)' }}>
                <span>↩ Replying to: {replyTo.content?.substring(0, 50)}</span>
                <button onClick={() => setReplyTo(null)} style={{ color: 'var(--red-b)' }}><X size={12} /></button>
              </div>
            )}

            {/* Input */}
            <form onSubmit={sendMessage} className="flex gap-2 p-4 shrink-0" style={{ borderTop: '1px solid var(--bg3)' }}>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Type a message..."
                className="grv-input flex-1 py-2.5 px-4 rounded-lg text-sm"
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(e)}
              />
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                className={clsx('p-2.5 rounded-lg transition-colors', recording ? 'btn-danger' : 'btn-ghost')}
                title="Hold to record audio"
              >
                {recording ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button type="submit" className="btn-primary px-4 py-2.5 rounded-lg flex items-center gap-2 text-sm">
                <Send size={14} />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col gap-3" style={{ color: 'var(--fg3)' }}>
            <MessageSquare size={48} className="opacity-20" />
            <p className="text-sm">Select a conversation or search for a user</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageSquare({ size, className }) {
  return <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>;
}
