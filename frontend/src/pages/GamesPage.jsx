import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sword, Users, Clock, Copy, Trash2, LogIn, Pause, Play, Settings } from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const CATEGORIES = ['general','animals','food','sports','music','movies','technology','nature'];

export default function GamesPage() {
  const { user } = useAuthStore();
  const { getSocket } = useSocketStore();
  const navigate = useNavigate();

  const [myLobbies, setMyLobbies]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [joinCode, setJoinCode]       = useState('');
  const [createForm, setCreateForm]   = useState({ name: '', maxPlayers: 10, turnTime: 30, wordCategory: 'general' });

  const fetchLobbies = async () => {
    try {
      const { data } = await api.get('/lobby/mine');
      setMyLobbies(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchLobbies(); }, []);

  // Listen for lobby:reset and lobby:discarded to refresh dashboard
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => fetchLobbies();
    socket.on('lobby:reset',     refresh);
    socket.on('lobby:discarded', refresh);
    return () => {
      socket.off('lobby:reset',     refresh);
      socket.off('lobby:discarded', refresh);
    };
  }, [getSocket]);

  const createLobby = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/lobby', createForm);
      toast.success(`Lobby created! Code: ${data.code}`);
      setShowCreate(false);
      setCreateForm({ name: '', maxPlayers: 10, turnTime: 30, wordCategory: 'general' });
      fetchLobbies();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create lobby'); }
  };

  const joinLobby = async (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    const code = joinCode.trim().toUpperCase();
    try {
      await api.post(`/lobby/${code}/join`);
      navigate(`/games/lobby/${code}`);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to join lobby'); }
  };

  const discardLobby = async (code) => {
    if (!confirm('Discard this lobby? All members will be removed.')) return;
    try {
      await api.delete(`/lobby/${code}`);
      toast.success('Lobby discarded');
      setMyLobbies(l => l.filter(lb => lb.code !== code));
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const leaveLobby = async (code) => {
    try {
      await api.post(`/lobby/${code}/leave`);
      toast.success('Left lobby');
      setMyLobbies(l => l.filter(lb => lb.code !== code));
    } catch (err) { toast.error(err.response?.data?.error || 'Cannot leave right now — pause the game first'); }
  };

  const copyCode = (code) => { navigator.clipboard.writeText(code); toast.success('Code copied!'); };

  // Group lobbies by status
  const activePlaying = myLobbies.filter(l => l.status === 'playing');
  const activePaused  = myLobbies.filter(l => l.status === 'paused');
  const waiting       = myLobbies.filter(l => l.status === 'waiting');

  return (
    <div className="h-full overflow-y-auto p-6" style={{ color: 'var(--fg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl" style={{ color: 'var(--yellow-b, #fabd2f)' }}>GAMES</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--fg3)' }}>
            Your lobbies persist — play as many rounds as you want
          </p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-sm">
          <Plus size={16} /> New Lobby
        </button>
      </div>

      {/* Join by code */}
      <form onSubmit={joinLobby} className="flex gap-2 mb-6">
        <input
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Enter lobby code to join (e.g. AB3X7K)"
          maxLength={6}
          className="grv-input flex-1 py-2.5 px-4 rounded text-sm uppercase tracking-widest font-bold"
        />
        <button type="submit" className="btn-primary px-4 py-2 rounded flex items-center gap-2 text-sm">
          <LogIn size={16} /> Join
        </button>
      </form>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createLobby} className="grv-panel rounded-lg p-4 mb-6 animate-fade-in">
          <h3 className="font-bold mb-4" style={{ color: 'var(--aqua-b)' }}>Create New Lobby</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Lobby Name</label>
              <input className="grv-input w-full py-2 px-3 rounded text-sm" placeholder="My Epic Lobby"
                value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Max Players</label>
              <input type="number" min={3} max={20} className="grv-input w-full py-2 px-3 rounded text-sm"
                value={createForm.maxPlayers} onChange={e => setCreateForm(f => ({ ...f, maxPlayers: +e.target.value }))} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Turn Time (sec)</label>
              <input type="number" min={15} max={120} className="grv-input w-full py-2 px-3 rounded text-sm"
                value={createForm.turnTime} onChange={e => setCreateForm(f => ({ ...f, turnTime: +e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Word Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button key={c} type="button"
                    onClick={() => setCreateForm(f => ({ ...f, wordCategory: c }))}
                    className={clsx('px-3 py-1 rounded text-xs font-bold capitalize transition-all',
                      createForm.wordCategory === c ? 'btn-primary' : 'btn-ghost')}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" className="btn-primary px-4 py-2 rounded text-sm flex items-center gap-2">
              <Plus size={14} /> Create
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost px-4 py-2 rounded text-sm">Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-16" style={{ color: 'var(--fg3)' }}>Loading your lobbies...</div>
      ) : (
        <div className="space-y-8">

          {/* ── Active / Playing ── */}
          {activePlaying.length > 0 && (
            <Section title="🎮 In Progress" colour="var(--blue-b)">
              {activePlaying.map(lobby => (
                <LobbyCard key={lobby.id} lobby={lobby} user={user}
                  onOpen={() => navigate(`/games/lobby/${lobby.code}`)}
                  onCopy={() => copyCode(lobby.code)}
                  onLeave={() => leaveLobby(lobby.code)}
                  onDiscard={() => discardLobby(lobby.code)}
                  isHost={lobby.host_id === user.id}
                />
              ))}
            </Section>
          )}

          {/* ── Paused ── */}
          {activePaused.length > 0 && (
            <Section title="⏸ Paused" colour="var(--yellow-b, #fabd2f)">
              <p className="text-xs mb-3 px-1" style={{ color: 'var(--fg3)' }}>
                These games are paused. Click a lobby to rejoin and resume.
              </p>
              {activePaused.map(lobby => (
                <LobbyCard key={lobby.id} lobby={lobby} user={user}
                  onOpen={() => navigate(`/games/lobby/${lobby.code}`)}
                  onCopy={() => copyCode(lobby.code)}
                  onLeave={() => leaveLobby(lobby.code)}
                  onDiscard={() => discardLobby(lobby.code)}
                  isHost={lobby.host_id === user.id}
                />
              ))}
            </Section>
          )}

          {/* ── Waiting ── */}
          {waiting.length > 0 && (
            <Section title="⏳ Waiting to Start" colour="var(--green-b)">
              {waiting.map(lobby => (
                <LobbyCard key={lobby.id} lobby={lobby} user={user}
                  onOpen={() => navigate(`/games/lobby/${lobby.code}`)}
                  onCopy={() => copyCode(lobby.code)}
                  onLeave={() => leaveLobby(lobby.code)}
                  onDiscard={() => discardLobby(lobby.code)}
                  isHost={lobby.host_id === user.id}
                />
              ))}
            </Section>
          )}

          {/* ── Empty state ── */}
          {myLobbies.length === 0 && (
            <div className="text-center py-16" style={{ color: 'var(--fg3)' }}>
              <Sword size={36} className="mx-auto mb-3 opacity-20" />
              <p className="mb-1">No lobbies yet.</p>
              <p className="text-xs">Create one or ask a friend for their lobby code.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, colour, children }) {
  return (
    <div>
      <h2 className="text-xs font-bold tracking-widest mb-3" style={{ color: colour }}>
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function LobbyCard({ lobby, user, onOpen, onCopy, onLeave, onDiscard, isHost }) {
  const statusColour = {
    waiting:  'var(--green-b)',
    playing:  'var(--blue-b)',
    paused:   'var(--yellow-b, #fabd2f)',
    finished: 'var(--fg3)',
  }[lobby.status] || 'var(--fg3)';

  const players = Array.isArray(lobby.players) ? lobby.players.filter(Boolean) : [];

  return (
    <div className="grv-panel rounded-lg p-4 flex items-center gap-4 group transition-all hover:border-grv-bg4"
      style={{ borderColor: 'var(--bg3)' }}>

      {/* Code */}
      <div className="font-display text-xl tracking-widest px-3 py-2 rounded shrink-0 text-center"
        style={{ background: 'var(--bg)', color: 'var(--yellow-b, #fabd2f)', minWidth: 90 }}>
        {lobby.code}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-bold text-sm truncate">{lobby.name}</span>
          {isHost && (
            <span className="text-xs px-1.5 py-0.5 rounded font-bold shrink-0"
              style={{ background: 'rgba(215,153,33,0.2)', color: 'var(--yellow)', border: '1px solid var(--yellow)' }}>
              HOST
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--fg3)' }}>
          <span className="flex items-center gap-1">
            <Users size={11} /> {lobby.player_count}/{lobby.max_players}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={11} /> {lobby.turn_time}s
          </span>
          <span className="font-bold capitalize" style={{ color: statusColour }}>
            ● {lobby.status}
          </span>
          {lobby.pause_reason && (
            <span className="truncate max-w-32" title={lobby.pause_reason}>
              — {lobby.pause_reason}
            </span>
          )}
        </div>

        {/* Player avatars */}
        {players.length > 0 && (
          <div className="flex items-center gap-1 mt-2">
            {players.slice(0, 8).map(p => p && (
              <div key={p.id} title={p.username}
                className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
                style={{ background: p.avatar_color || '#458588', color: '#282828' }}>
                {p.username?.[0]?.toUpperCase()}
              </div>
            ))}
            {players.length > 8 && (
              <span className="text-xs" style={{ color: 'var(--fg3)' }}>+{players.length - 8}</span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1 shrink-0">
        <button onClick={onCopy} className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Copy code">
          <Copy size={14} />
        </button>
        <button onClick={onOpen} className="btn-primary px-3 py-2 rounded text-xs font-bold flex items-center gap-1">
          {lobby.status === 'paused' ? <><Play size={13} /> Resume</> :
           lobby.status === 'playing' ? <><Play size={13} /> Rejoin</> :
           <><LogIn size={13} /> Open</>}
        </button>
        {!isHost && (
          <button onClick={onLeave} className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Leave lobby" style={{ color: 'var(--orange-b)' }}>
            <LogIn size={14} style={{ transform: 'scaleX(-1)' }} />
          </button>
        )}
        {isHost && (
          <button onClick={onDiscard} className="btn-ghost p-2 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Discard lobby" style={{ color: 'var(--red-b)' }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
