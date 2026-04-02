import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play, Pause, RotateCcw, Settings, Copy, ArrowLeft,
  Mic, MicOff, Send, Smile, Reply, X, Volume2, VolumeX,
  Shield, Sword, Crown, Wifi, WifiOff, Vote, Eye
} from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const REACTIONS = ['👍','❤️','😂','😮','🔥','🎮','🕵️','💀'];

export default function LobbyPage() {
  const { code } = useParams();
  const { user } = useAuthStore();
  const { getSocket } = useSocketStore();
  const navigate = useNavigate();

  const [lobby, setLobby] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState(null);  // innocent | imposter
  const [myWord, setMyWord] = useState(null);
  const [imposterCount, setImposterCount] = useState(0);
  const [voting, setVoting] = useState(false);
  const [myVote, setMyVote] = useState(null);
  const [voteResults, setVoteResults] = useState({});  // userId -> count
  const [gameResult, setGameResult] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pauseInfo, setPauseInfo] = useState(null);
  const [disconnectedUsers, setDisconnectedUsers] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [showReactions, setShowReactions] = useState(null);
  const [recording, setRecording] = useState(false);
  const [liveAudioUsers, setLiveAudioUsers] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ turnTime: 30, maxPlayers: 10 });
  const [showWordGuess, setShowWordGuess] = useState(false);
  const [wordGuess, setWordGuess] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [showReactionPicker, setShowReactionPicker] = useState(null);

  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const typingTimeoutRef = useRef(null);

  const isHost = lobby?.host_id === user.id;
  const me = lobby?.players?.find(p => p.id === user.id);
  const activePlayers = lobby?.players?.filter(p => !p.is_eliminated) || [];

  const scrollBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  // Fetch lobby data
  const fetchLobby = async () => {
    try {
      const { data } = await api.get(`/lobby/${code}`);
      setLobby(data);
      setPaused(data.status === 'paused');
      setSettings({ turnTime: data.turn_time, maxPlayers: data.max_players });
    } catch (err) {
      toast.error('Lobby not found');
      navigate('/games');
    }
    setLoading(false);
  };

  // Fetch lobby chat messages
  const fetchMessages = async () => {
    try {
      const { data } = await api.get(`/lobby/${code}/messages`).catch(() => ({ data: [] }));
      setMessages(data);
      setTimeout(scrollBottom, 100);
    } catch {}
  };

  useEffect(() => {
    fetchLobby();
    fetchMessages();
  }, [code]);

  // Join socket room
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('lobby:join', { code });

    const handlers = {
      'lobby:playerJoined': ({ userId, username, avatar_color }) => {
        setLobby(l => l ? {
          ...l,
          players: [...(l.players || []).filter(p => p.id !== userId), { id: userId, username, avatar_color, is_eliminated: false }]
        } : l);
        addSystemMsg(`${username} joined the lobby`);
      },
      'lobby:playerLeft': ({ userId }) => {
        setLobby(l => l ? { ...l, players: (l.players || []).filter(p => p.id !== userId) } : l);
      },
      'lobby:hostChanged': ({ newHostId }) => {
        setLobby(l => l ? { ...l, host_id: newHostId } : l);
      },
      'lobby:settingsUpdated': (updatedLobby) => {
        setLobby(l => ({ ...l, ...updatedLobby }));
        setSettings({ turnTime: updatedLobby.turn_time, maxPlayers: updatedLobby.max_players });
        addSystemMsg('Host updated lobby settings');
      },
      'lobby:message': (msg) => {
        setMessages(m => [...m, msg]);
        setTimeout(scrollBottom, 50);
      },
      'lobby:reaction': ({ messageId, reactions }) => {
        setMessages(m => m.map(msg => msg.id === messageId ? { ...msg, reactions } : msg));
      },
      'lobby:typing': ({ userId: uid, username, isTyping }) => {
        if (uid === user.id) return;
        setTypingUsers(t => isTyping ? [...t.filter(u => u.id !== uid), { id: uid, username }] : t.filter(u => u.id !== uid));
      },
      'lobby:audioStreamStart': ({ userId: uid, username }) => {
        setLiveAudioUsers(u => [...u.filter(x => x.id !== uid), { id: uid, username }]);
      },
      'lobby:audioStreamEnd': ({ userId: uid }) => {
        setLiveAudioUsers(u => u.filter(x => x.id !== uid));
      },

      // Game events
      'game:started': ({ role, word, imposterCount: ic, totalPlayers }) => {
        setMyRole(role);
        setMyWord(word);
        setImposterCount(ic);
        setGameResult(null);
        setVoting(false);
        setMyVote(null);
        setVoteResults({});
        fetchLobby();
        addSystemMsg(`🎮 Game started! ${ic} imposter${ic > 1 ? 's' : ''} among ${totalPlayers} players.`);
      },
      'game:announcement': ({ message }) => {
        addSystemMsg(message);
      },
      'game:votingStarted': ({ round }) => {
        setVoting(true);
        setMyVote(null);
        setVoteResults({});
        addSystemMsg(`🗳️ Voting round ${round} started! Choose who to eliminate.`);
      },
      'game:voteReceived': ({ voterId, votedForId, totalVotes, totalPlayers }) => {
        setVoteResults(v => ({ ...v, [votedForId]: (v[votedForId] || 0) + 1 }));
        addSystemMsg(`🗳️ Votes: ${totalVotes}/${totalPlayers} cast`);
      },
      'game:voteTie': ({ message, tiedPlayers }) => {
        setVoting(true);
        setMyVote(null);
        setVoteResults({});
        addSystemMsg(`⚖️ ${message}`);
      },
      'game:playerEliminated': ({ userId: uid, username, role, word, votes }) => {
        setLobby(l => l ? {
          ...l,
          players: (l.players || []).map(p => p.id === uid ? { ...p, is_eliminated: true, role, assigned_word: word } : p)
        } : l);
        setVoting(false);
        addSystemMsg(`💀 ${username} was eliminated! They were ${role === 'imposter' ? '🔴 an IMPOSTER' : '🔵 an INNOCENT'} (word: ${word})`);
      },
      'game:paused': ({ pausedBy, reason }) => {
        setPaused(true);
        setPauseInfo({ pausedBy, reason });
        addSystemMsg(`⏸️ Game paused by ${pausedBy}${reason ? `: ${reason}` : ''}`);
      },
      'game:resumed': ({ resumedBy }) => {
        setPaused(false);
        setPauseInfo(null);
        addSystemMsg(`▶️ Game resumed by ${resumedBy}`);
      },
      'game:playerDisconnected': ({ username, message }) => {
        setDisconnectedUsers(d => [...d, username]);
        addSystemMsg(`📡 ${message}`);
      },
      'game:playerReconnected': ({ username }) => {
        setDisconnectedUsers(d => d.filter(u => u !== username));
        addSystemMsg(`✅ ${username} reconnected`);
      },
      'game:wrongGuess': ({ guessedWord, message }) => {
        addSystemMsg(`❌ ${message} (guessed: ${guessedWord})`);
      },
      'game:ended': (result) => {
        setGameResult(result);
        setMyRole(null);
        setMyWord(null);
        setVoting(false);
        fetchLobby();
        addSystemMsg(`🏆 Game Over! ${result.winner === 'innocents' ? '🔵 Innocents' : '🔴 Imposters'} win! Reason: ${result.reason}`);
        addSystemMsg(`📖 Innocent word: "${result.innocentWord}" | Imposter word: "${result.imposterWord}"`);
      },
    };

    Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler));

    return () => {
      Object.keys(handlers).forEach(event => socket.off(event, handlers[event]));
      socket.emit('lobby:leave', { code });
    };
  }, [code, user.id, getSocket]);

  const addSystemMsg = (content) => {
    setMessages(m => [...m, {
      id: `sys-${Date.now()}`,
      content,
      message_type: 'system',
      created_at: new Date().toISOString(),
    }]);
    setTimeout(scrollBottom, 50);
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const socket = getSocket();
    socket?.emit('lobby:message', { code, content: text.trim(), replyToId: replyTo?.id });
    setText('');
    setReplyTo(null);
    clearTyping();
  };

  const handleTyping = (e) => {
    setText(e.target.value);
    const socket = getSocket();
    socket?.emit('lobby:typing', { code, isTyping: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(clearTyping, 1500);
  };

  const clearTyping = () => {
    const socket = getSocket();
    socket?.emit('lobby:typing', { code, isTyping: false });
  };

  const startGame = async () => {
    try {
      await api.post(`/game/${code}/start`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start game');
    }
  };

  const startVoting = async () => {
    try {
      await api.post(`/game/${code}/voting/start`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start voting');
    }
  };

  const castVote = async (targetId) => {
    if (myVote || me?.is_eliminated) return;
    try {
      await api.post(`/game/${code}/vote`, { votedForId: targetId });
      setMyVote(targetId);
      toast.success('Vote cast!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to vote');
    }
  };

  const pauseGame = async (reason = '') => {
    try {
      await api.post(`/game/${code}/pause`, { reason });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to pause');
    }
  };

  const resumeGame = async () => {
    try {
      await api.post(`/game/${code}/resume`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to resume');
    }
  };

  const guessWord = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post(`/game/${code}/guess-word`, { guessedWord: wordGuess });
      if (data.correct) toast.success('Correct! Imposters win!');
      else toast.error('Wrong guess! You are eliminated.');
      setShowWordGuess(false);
      setWordGuess('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to guess');
    }
  };

  const startLiveAudio = () => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const socket = getSocket();
      socket?.emit('lobby:audioStreamStart', { code });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => socket?.emit('lobby:audioStream', { code, audioChunk: e.data });
      mr.start(100);
      setRecording(true);
    }).catch(() => toast.error('Microphone access denied'));
  };

  const stopLiveAudio = () => {
    mediaRecorderRef.current?.stop();
    getSocket()?.emit('lobby:audioStreamEnd', { code });
    setRecording(false);
  };

  const sendAudioMessage = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);
        getSocket()?.emit('lobby:message', { code, content: '🎙️ Audio message', messageType: 'audio', audioUrl });
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setTimeout(() => mr.stop(), 10000); // max 10s
      toast('Recording... (max 10s)', { icon: '🎙️' });
    } catch { toast.error('Mic access denied'); }
  };

  const addReaction = (messageId, emoji) => {
    getSocket()?.emit('lobby:reaction', { code, messageId, emoji });
    setShowReactionPicker(null);
  };

  const saveSettings = async () => {
    try {
      await api.patch(`/lobby/${code}/settings`, settings);
      toast.success('Settings saved!');
      setShowSettings(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    toast.success('Code copied!');
  };

  const leaveLobby = async () => {
    try {
      await api.post(`/lobby/${code}/leave`);
      navigate('/games');
    } catch {
      navigate('/games');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--fg3)' }}>
        <div className="text-center">
          <div className="font-display text-4xl mb-2" style={{ color: 'var(--yellow)' }}>🕵️</div>
          <p>Loading lobby...</p>
        </div>
      </div>
    );
  }

  if (!lobby) return null;

  const isPlaying = lobby.status === 'playing';
  const isWaiting = lobby.status === 'waiting';
  const isFinished = lobby.status === 'finished';

  return (
    <div className="h-full flex flex-col" style={{ color: 'var(--fg)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--bg3)' }}>
        <button onClick={leaveLobby} className="btn-ghost p-2 rounded" title="Leave lobby">
          <ArrowLeft size={16} />
        </button>

        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl tracking-widest" style={{ color: 'var(--yellow-b, #fabd2f)' }}>{code}</span>
            <button onClick={copyCode} className="p-1 rounded" style={{ color: 'var(--fg3)' }}><Copy size={13} /></button>
          </div>
          <div className="text-xs" style={{ color: 'var(--fg3)' }}>{lobby.name} · {activePlayers.length}/{lobby.max_players} players</div>
        </div>

        <div className="flex-1" />

        {/* Status badge */}
        <StatusBadge status={paused ? 'paused' : lobby.status} />

        {/* Host controls */}
        {isHost && (
          <div className="flex gap-1">
            {isWaiting && (
              <button onClick={startGame} className="btn-primary px-3 py-1.5 rounded text-xs flex items-center gap-1">
                <Play size={13} /> Start
              </button>
            )}
            {isPlaying && !voting && !paused && (
              <button onClick={startVoting} className="px-3 py-1.5 rounded text-xs flex items-center gap-1"
                style={{ background: 'var(--purple)', color: 'var(--fg)', border: '1px solid var(--purple-b)' }}>
                <Vote size={13} /> Start Voting
              </button>
            )}
            {isHost && (
              <button onClick={() => setShowSettings(v => !v)} className="btn-ghost p-2 rounded"><Settings size={15} /></button>
            )}
          </div>
        )}

        {/* Pause/Resume - any player */}
        {isPlaying && !paused && (
          <button onClick={() => pauseGame()} className="btn-ghost px-3 py-1.5 rounded text-xs flex items-center gap-1">
            <Pause size={13} /> Pause
          </button>
        )}
        {paused && (
          <button onClick={resumeGame} className="btn-primary px-3 py-1.5 rounded text-xs flex items-center gap-1">
            <Play size={13} /> Resume
          </button>
        )}
      </div>

      {/* Pause overlay notice */}
      {paused && pauseInfo && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs" style={{ background: 'rgba(215,153,33,0.15)', borderBottom: '1px solid var(--yellow)', color: 'var(--yellow-b, #fabd2f)' }}>
          <Pause size={13} />
          <span>Game paused by <strong>{pauseInfo.pausedBy}</strong>{pauseInfo.reason ? ` — ${pauseInfo.reason}` : ''}. Any player can resume.</span>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && isHost && (
        <div className="px-4 py-3 shrink-0 animate-fade-in" style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--bg3)' }}>
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--fg3)' }}>Turn Time (sec)</label>
              <input type="number" min={15} max={120} value={settings.turnTime}
                onChange={e => setSettings(s => ({ ...s, turnTime: +e.target.value }))}
                className="grv-input w-24 py-1.5 px-2 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--fg3)' }}>Max Players</label>
              <input type="number" min={3} max={20} value={settings.maxPlayers}
                onChange={e => setSettings(s => ({ ...s, maxPlayers: +e.target.value }))}
                className="grv-input w-20 py-1.5 px-2 rounded text-sm" />
            </div>
            <button onClick={saveSettings} className="btn-primary px-3 py-1.5 rounded text-xs">Save</button>
            <button onClick={() => setShowSettings(false)} className="btn-ghost px-3 py-1.5 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Players panel */}
        <div className="w-56 shrink-0 flex flex-col" style={{ background: 'var(--bg1)', borderRight: '1px solid var(--bg3)' }}>
          {/* My word card */}
          {myWord && (
            <div className="p-3 m-3 rounded-lg text-center" style={{ background: 'var(--bg)', border: `2px solid ${myRole === 'imposter' ? 'var(--red)' : 'var(--blue)'}` }}>
              <div className="text-xs mb-1 font-bold" style={{ color: myRole === 'imposter' ? 'var(--red-b)' : 'var(--blue-b)' }}>
                {myRole === 'imposter' ? '🔴 IMPOSTER' : '🔵 INNOCENT'}
              </div>
              <div className="font-display text-2xl uppercase tracking-widest" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                {myWord}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--fg3)' }}>Your word</div>
              {myRole === 'imposter' && isPlaying && !paused && (
                <button onClick={() => setShowWordGuess(true)} className="mt-2 btn-danger w-full py-1 rounded text-xs">
                  Guess Innocent Word
                </button>
              )}
            </div>
          )}

          {/* Imposter count display (waiting/no role) */}
          {!myWord && isPlaying && (
            <div className="p-3 text-center" style={{ color: 'var(--fg3)' }}>
              <Eye size={20} className="mx-auto mb-1 opacity-50" />
              <p className="text-xs">Spectating</p>
            </div>
          )}

          <div className="px-3 py-2">
            <div className="text-xs font-bold tracking-widest mb-2" style={{ color: 'var(--fg3)' }}>
              PLAYERS ({lobby.players?.length || 0})
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {(lobby.players || []).map(p => {
              const isElim = p.is_eliminated;
              const isMe = p.id === user.id;
              const isLobbyHost = p.id === lobby.host_id;
              const voteCount = voteResults[p.id] || 0;
              const isDisconnected = disconnectedUsers.includes(p.username);

              return (
                <div
                  key={p.id}
                  onClick={() => voting && !myVote && !isElim && !isMe && !me?.is_eliminated && castVote(p.id)}
                  className={clsx(
                    'flex items-center gap-2 p-2 rounded-lg transition-all text-left',
                    isElim ? 'opacity-40' : '',
                    voting && !myVote && !isElim && !isMe && !me?.is_eliminated
                      ? 'cursor-pointer hover:bg-grv-bg3 border border-transparent hover:border-purple-500'
                      : '',
                    myVote === p.id ? 'border border-purple-500 bg-purple-900/20' : '',
                  )}
                  style={{ background: isElim ? 'transparent' : 'var(--bg)' }}
                >
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-xs"
                      style={{ background: isElim ? 'var(--bg3)' : (p.avatar_color || '#458588'), color: '#282828' }}>
                      {p.username?.[0]?.toUpperCase()}
                    </div>
                    {isLobbyHost && !isElim && (
                      <Crown size={10} className="absolute -top-1 -right-1" style={{ color: 'var(--yellow)' }} />
                    )}
                    {isDisconnected && (
                      <WifiOff size={10} className="absolute -bottom-1 -right-1" style={{ color: 'var(--red-b)' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={clsx('text-xs font-bold truncate', isElim && 'line-through')}>
                      {p.username}{isMe && ' (you)'}
                    </div>
                    {isElim && p.role && (
                      <div className="text-xs" style={{ color: p.role === 'imposter' ? 'var(--red-b)' : 'var(--blue-b)' }}>
                        {p.role === 'imposter' ? '🔴' : '🔵'} {p.assigned_word}
                      </div>
                    )}
                    {!isElim && isPlaying && (
                      <div className="text-xs" style={{ color: 'var(--fg3)' }}>
                        {p.assigned_word && isMe ? p.assigned_word : 'Active'}
                      </div>
                    )}
                  </div>
                  {voting && voteCount > 0 && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--purple)', color: 'var(--fg)' }}>
                      {voteCount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live audio users */}
          {liveAudioUsers.length > 0 && (
            <div className="p-2 border-t" style={{ borderColor: 'var(--bg3)' }}>
              <div className="text-xs" style={{ color: 'var(--green-b)' }}>
                🎙️ {liveAudioUsers.map(u => u.username).join(', ')} speaking
              </div>
            </div>
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Game result banner */}
          {gameResult && (
            <div className="p-4 text-center shrink-0 animate-fade-in"
              style={{ background: gameResult.winner === 'innocents' ? 'rgba(69,133,136,0.2)' : 'rgba(204,36,29,0.2)', borderBottom: '2px solid ' + (gameResult.winner === 'innocents' ? 'var(--blue)' : 'var(--red)') }}>
              <div className="font-display text-3xl mb-1" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                {gameResult.winner === 'innocents' ? '🔵 INNOCENTS WIN!' : '🔴 IMPOSTERS WIN!'}
              </div>
              <div className="text-xs" style={{ color: 'var(--fg3)' }}>
                Innocent word: <strong style={{ color: 'var(--blue-b)' }}>{gameResult.innocentWord}</strong>
                &nbsp;·&nbsp;
                Imposter word: <strong style={{ color: 'var(--red-b)' }}>{gameResult.imposterWord}</strong>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--fg2)' }}>{gameResult.reason}</div>
            </div>
          )}

          {/* Voting banner */}
          {voting && !me?.is_eliminated && (
            <div className="px-4 py-2 shrink-0 text-center text-xs font-bold"
              style={{ background: 'rgba(177,98,134,0.2)', borderBottom: '1px solid var(--purple)', color: 'var(--purple-b)' }}>
              🗳️ VOTING IN PROGRESS — Click a player on the left to vote!
              {myVote && <span style={{ color: 'var(--green-b)' }}> ✓ Vote cast</span>}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {messages.map((msg, i) => {
              if (msg.message_type === 'system') {
                return (
                  <div key={msg.id || i} className="text-center text-xs py-1 px-3 rounded"
                    style={{ color: 'var(--fg3)', background: 'var(--bg2)', margin: '4px auto', maxWidth: '90%' }}>
                    {msg.content}
                  </div>
                );
              }
              const isMe = msg.sender_id === user.id;
              return (
                <div key={msg.id || i} className={clsx('flex gap-2 group', { 'flex-row-reverse': isMe })}>
                  {!isMe && (
                    <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold shrink-0 mt-1"
                      style={{ background: msg.sender_avatar || '#458588', color: '#282828' }}>
                      {msg.sender_username?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="max-w-xs">
                    {!isMe && <div className="text-xs mb-0.5 pl-1" style={{ color: 'var(--fg3)' }}>{msg.sender_username}</div>}
                    {msg.reply_to_id && (
                      <div className="text-xs mb-1 px-2 py-1 rounded border-l-2 opacity-70"
                        style={{ borderColor: 'var(--blue)', background: 'var(--bg2)', color: 'var(--fg3)' }}>
                        ↩ {msg.reply_content?.substring(0, 40) || '...'}
                      </div>
                    )}
                    <div className="px-3 py-2 rounded-lg text-sm"
                      style={{ background: isMe ? 'var(--blue)' : 'var(--bg2)', color: 'var(--fg)' }}>
                      {msg.message_type === 'audio'
                        ? <audio controls src={msg.audio_url} className="max-w-full" style={{ height: 30 }} />
                        : <span style={{ wordBreak: 'break-word' }}>{msg.content}</span>}
                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(msg.reactions).map(([emoji, users]) => (
                            <span key={emoji} className="text-xs px-1 rounded cursor-pointer"
                              style={{ background: 'var(--bg3)' }}
                              onClick={() => addReaction(msg.id, emoji)}>
                              {emoji} {Array.isArray(users) ? users.length : 0}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2"
                      style={{ color: 'var(--fg3)', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                      <button onClick={() => setReplyTo(msg)}>↩ reply</button>
                      <button onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}>
                        <Smile size={11} />
                      </button>
                    </div>
                    {showReactionPicker === msg.id && (
                      <div className="flex gap-1 mt-1 p-2 rounded z-10"
                        style={{ background: 'var(--bg2)', border: '1px solid var(--bg3)' }}>
                        {REACTIONS.map(e => (
                          <button key={e} onClick={() => addReaction(msg.id, e)}
                            className="text-base hover:scale-125 transition-transform">{e}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {typingUsers.length > 0 && (
              <div className="text-xs italic" style={{ color: 'var(--fg3)' }}>
                {typingUsers.map(u => u.username).join(', ')} typing...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply banner */}
          {replyTo && (
            <div className="mx-3 mb-1 px-2 py-1 rounded flex items-center justify-between text-xs"
              style={{ background: 'var(--bg2)', border: '1px solid var(--blue)', color: 'var(--fg3)' }}>
              <span>↩ {replyTo.sender_username}: {replyTo.content?.substring(0, 40)}</span>
              <button onClick={() => setReplyTo(null)} style={{ color: 'var(--red-b)' }}><X size={11} /></button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={sendMessage} className="flex gap-2 p-3 shrink-0" style={{ borderTop: '1px solid var(--bg3)' }}>
            <input
              value={text}
              onChange={handleTyping}
              placeholder="Message the lobby..."
              className="grv-input flex-1 py-2 px-3 rounded text-sm"
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(e)}
            />
            <button type="button" onClick={sendAudioMessage}
              className="btn-ghost p-2 rounded" title="Send audio message">
              <Mic size={15} />
            </button>
            <button
              type="button"
              onMouseDown={startLiveAudio}
              onMouseUp={stopLiveAudio}
              className={clsx('p-2 rounded', recording ? 'btn-danger' : 'btn-ghost')}
              title="Hold for live audio"
            >
              {recording ? <MicOff size={15} /> : <Volume2 size={15} />}
            </button>
            <button type="submit" className="btn-primary px-3 py-2 rounded flex items-center gap-1 text-sm">
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>

      {/* Word guess modal */}
      {showWordGuess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="grv-panel rounded-xl p-6 w-full max-w-sm animate-slide-up">
            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--red-b)' }}>🔴 Guess the Innocent Word</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--fg3)' }}>
              If you guess correctly, imposters win. If wrong, you're eliminated.
            </p>
            <form onSubmit={guessWord}>
              <input
                value={wordGuess}
                onChange={e => setWordGuess(e.target.value)}
                placeholder="Type your guess..."
                className="grv-input w-full py-2.5 px-3 rounded mb-3 text-sm"
                autoFocus
              />
              <div className="flex gap-2">
                <button type="submit" className="btn-danger flex-1 py-2 rounded text-sm font-bold">Submit Guess</button>
                <button type="button" onClick={() => setShowWordGuess(false)} className="btn-ghost px-4 py-2 rounded text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    waiting: { color: 'var(--green-b)', label: '● Waiting' },
    playing: { color: 'var(--blue-b)', label: '▶ Playing' },
    paused:  { color: 'var(--yellow-b, #fabd2f)', label: '⏸ Paused' },
    finished:{ color: 'var(--fg3)', label: '■ Finished' },
  }[status] || { color: 'var(--fg3)', label: status };

  return (
    <span className="text-xs font-bold px-2 py-1 rounded" style={{ color: config.color, background: 'var(--bg)' }}>
      {config.label}
    </span>
  );
}
