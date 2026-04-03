import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, MessageSquare, Sword, Check, X, Search } from 'lucide-react';
import api from '../utils/api';
import { useSocketStore } from '../store/socketStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export default function FriendsPage() {
  const [friends, setFriends] = useState([]);
  const [search, setSearch] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const { getSocket, onlineUsers } = useSocketStore();
  const navigate = useNavigate();

  const fetchFriends = async () => {
    try {
      const { data } = await api.get('/friends');
      setFriends(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchFriends(); }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onRequest = (data) => {
      setFriends(f => [...f, { ...data.from, friendship_id: data.friendshipId, friendship_status: 'pending', direction: 'received' }]);
    };
    const onAccepted = () => fetchFriends();

    socket.on('friend:request', onRequest);
    socket.on('friend:accepted', onAccepted);
    return () => { socket.off('friend:request', onRequest); socket.off('friend:accepted', onAccepted); };
  }, [getSocket]);

  const sendRequest = async (e) => {
    e.preventDefault();
    if (!addUsername.trim()) return;
    try {
      await api.post('/friends/request', { username: addUsername.trim() });
      toast.success('Friend request sent!');
      setAddUsername('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send request');
    }
  };

  const acceptRequest = async (friendshipId) => {
    try {
      await api.post(`/friends/accept/${friendshipId}`);
      toast.success('Friend added!');
      fetchFriends();
    } catch {}
  };

  const removeFriend = async (friendshipId) => {
    try {
      await api.delete(`/friends/${friendshipId}`);
      setFriends(f => f.filter(fr => fr.friendship_id !== friendshipId));
    } catch {}
  };

  const sendInvite = async (friend) => {
    // User must have a lobby - prompt them to share the lobby code
    try {
      const { data: lobbies } = await api.get('/users/me/lobbies');
      const activeLobby = lobbies.find(l => l.status === 'waiting');
      if (!activeLobby) {
        toast.error('Create a game lobby first in the Games section!');
        return;
      }
      // Send DM with lobby code
      await api.post('/chat/messages', {
        receiverId: friend.id,
        content: `🎮 Join my game lobby! Code: **${activeLobby.code}**\n${window.location.origin}/games/lobby/${activeLobby.code}`,
        messageType: 'system',
      });
      toast.success(`Invite sent to ${friend.username}!`);
    } catch (err) {
      toast.error('Failed to send invite');
    }
  };

  const getStatus = (friend) => {
    return onlineUsers[friend.id] || friend.status || 'offline';
  };

  const accepted = friends.filter(f => f.friendship_status === 'accepted');
  const pending = friends.filter(f => f.friendship_status === 'pending');
  const filtered = accepted.filter(f => f.username.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="h-full flex flex-col p-4 md:p-6 overflow-y-auto" style={{ color: 'var(--fg)' }}>
      <h1 className="font-display text-3xl md:text-4xl mb-1" style={{ color: 'var(--yellow-b, #fabd2f)' }}>FRIENDS</h1>
      <p className="text-xs mb-6" style={{ color: 'var(--fg3)' }}>Connect with other players</p>

      {/* Add friend */}
      <form onSubmit={sendRequest} className="flex gap-2 mb-6">
        <input
          value={addUsername}
          onChange={e => setAddUsername(e.target.value)}
          placeholder="Add friend by username..."
          className="grv-input flex-1 py-2.5 px-4 rounded text-sm"
        />
        <button type="submit" className="btn-primary px-4 py-2 rounded flex items-center gap-2 text-sm">
          <UserPlus size={16} /> Add
        </button>
      </form>

      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold mb-2 tracking-widest" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
            PENDING ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map(f => (
              <div key={f.friendship_id} className="grv-panel rounded-lg p-3 flex items-center gap-3">
                <Avatar user={f} status={getStatus(f)} />
                <div className="flex-1">
                  <div className="font-bold text-sm">{f.username}</div>
                  <div className="text-xs" style={{ color: 'var(--fg3)' }}>
                    {f.direction === 'received' ? '← Wants to be friends' : '→ Request sent'}
                  </div>
                </div>
                {f.direction === 'received' && (
                  <div className="flex gap-1">
                    <button onClick={() => acceptRequest(f.friendship_id)} className="btn-primary p-2 rounded" title="Accept">
                      <Check size={14} />
                    </button>
                    <button onClick={() => removeFriend(f.friendship_id)} className="btn-danger p-2 rounded" title="Decline">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold tracking-widest" style={{ color: 'var(--fg3)' }}>
            FRIENDS ({accepted.length})
          </h2>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg3)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="grv-input pl-8 pr-3 py-1.5 rounded text-xs w-36"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--fg3)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--fg3)' }}>
            <UserPlus size={32} className="mx-auto mb-3 opacity-30" />
            <p>{search ? 'No friends match your search' : 'No friends yet. Add some!'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(friend => {
              const status = getStatus(friend);
              return (
                <div key={friend.friendship_id} className="grv-panel rounded-lg p-3 flex items-center gap-3 group hover:border-grv-bg4 transition-all">
                  <Avatar user={friend} status={status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm">{friend.username}</div>
                    <div className="text-xs capitalize" style={{ color: status === 'online' ? 'var(--green-b)' : status === 'busy' ? 'var(--red-b)' : 'var(--fg3)' }}>
                      {status === 'busy' ? '🎮 In Game' : status === 'online' ? '● Online' : '○ Offline'}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => navigate(`/chat/${friend.id}`)}
                      className="btn-ghost p-2 rounded"
                      title="Send message"
                    >
                      <MessageSquare size={14} />
                    </button>
                    <button
                      onClick={() => sendInvite(friend)}
                      className="btn-primary p-2 rounded"
                      title="Send game invite"
                    >
                      <Sword size={14} />
                    </button>
                    <button
                      onClick={() => removeFriend(friend.friendship_id)}
                      className="btn-ghost p-2 rounded"
                      title="Remove friend"
                      style={{ color: 'var(--red-b)' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ user, status }) {
  const statusClass = { online: 'status-online', busy: 'status-busy', offline: 'status-offline' }[status] || 'status-offline';
  return (
    <div className="relative shrink-0">
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
        style={{ background: user.avatar_color || '#458588', color: '#282828' }}
      >
        {user.username?.[0]?.toUpperCase()}
      </div>
      <span className={clsx('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2', statusClass)}
        style={{ borderColor: 'var(--bg1)' }} />
    </div>
  );
}
