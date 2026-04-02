import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sword, Users, Clock, Settings, Copy, Trash2, Play, LogIn } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export default function GamesPage() {
  const [lobbies, setLobbies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', maxPlayers: 10, turnTime: 30, wordCategory: 'general' });
  const navigate = useNavigate();

  const fetchLobbies = async () => {
    try {
      const { data } = await api.get('/users/me/lobbies');
      setLobbies(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchLobbies(); }, []);

  const createLobby = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/lobby', createForm);
      toast.success(`Lobby created! Code: ${data.code}`);
      setShowCreate(false);
      setLobbies(l => [{ ...data, player_count: 0 }, ...l]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create lobby');
    }
  };

  const joinLobby = async (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    try {
      await api.post(`/lobby/${joinCode.trim().toUpperCase()}/join`);
      navigate(`/games/lobby/${joinCode.trim().toUpperCase()}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to join lobby');
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Code copied!');
  };

  const deleteLobby = async (code) => {
    // Just leave, backend handles it
    try {
      await api.post(`/lobby/${code}/leave`);
      setLobbies(l => l.filter(lb => lb.code !== code));
      toast.success('Lobby closed');
    } catch {}
  };

  const CATEGORIES = ['general', 'animals', 'food', 'sports', 'music', 'movies', 'technology', 'nature'];

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto" style={{ color: 'var(--fg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl" style={{ color: 'var(--yellow-b, #fabd2f)' }}>GAMES</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--fg3)' }}>Create or join a game lobby</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(v => !v)}
            className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-sm"
          >
            <Plus size={16} /> New Lobby
          </button>
        </div>
      </div>

      {/* Join lobby */}
      <form onSubmit={joinLobby} className="flex gap-2 mb-6">
        <input
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Enter lobby code (e.g. AB3X7K)"
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
              <input
                className="grv-input w-full py-2 px-3 rounded text-sm"
                placeholder="My Epic Game"
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Max Players</label>
              <input
                type="number" min={3} max={20}
                className="grv-input w-full py-2 px-3 rounded text-sm"
                value={createForm.maxPlayers}
                onChange={e => setCreateForm(f => ({ ...f, maxPlayers: +e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Turn Time (sec)</label>
              <input
                type="number" min={15} max={120}
                className="grv-input w-full py-2 px-3 rounded text-sm"
                value={createForm.turnTime}
                onChange={e => setCreateForm(f => ({ ...f, turnTime: +e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs mb-1 block" style={{ color: 'var(--fg3)' }}>Word Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => setCreateForm(f => ({ ...f, wordCategory: c }))}
                    className={clsx('px-3 py-1 rounded text-xs font-bold transition-all capitalize', {
                      'btn-primary': createForm.wordCategory === c,
                      'btn-ghost': createForm.wordCategory !== c,
                    })}
                  >
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
            <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost px-4 py-2 rounded text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Lobby list */}
      <div>
        <h2 className="text-xs font-bold mb-3 tracking-widest" style={{ color: 'var(--fg3)' }}>
          YOUR LOBBIES ({lobbies.length})
        </h2>
        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--fg3)' }}>Loading...</div>
        ) : lobbies.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--fg3)' }}>
            <Sword size={32} className="mx-auto mb-3 opacity-30" />
            <p>No lobbies yet. Create one or join with a code!</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {lobbies.map(lobby => (
              <LobbyCard
                key={lobby.id}
                lobby={lobby}
                onCopy={() => copyCode(lobby.code)}
                onDelete={() => deleteLobby(lobby.code)}
                onOpen={() => navigate(`/games/lobby/${lobby.code}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LobbyCard({ lobby, onCopy, onDelete, onOpen }) {
  const statusColors = {
    waiting: 'var(--green-b)',
    playing: 'var(--red-b)',
    paused: 'var(--yellow-b, #fabd2f)',
    finished: 'var(--fg3)',
  };

  return (
    <div className="grv-panel rounded-lg p-4 flex items-center gap-4 hover:border-grv-bg4 transition-all group" style={{ borderColor: 'var(--bg3)' }}>
      {/* Code */}
      <div className="font-display text-2xl tracking-widest px-4 py-2 rounded" style={{ background: 'var(--bg)', color: 'var(--yellow-b, #fabd2f)', minWidth: 100, textAlign: 'center' }}>
        {lobby.code}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate">{lobby.name}</div>
        <div className="flex gap-3 mt-1">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--fg3)' }}>
            <Users size={11} /> {lobby.player_count}/{lobby.max_players}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--fg3)' }}>
            <Clock size={11} /> {lobby.turn_time}s turns
          </span>
          <span className="text-xs font-bold capitalize" style={{ color: statusColors[lobby.status] }}>
            ● {lobby.status}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onCopy} className="btn-ghost p-2 rounded" title="Copy code"><Copy size={14} /></button>
        <button onClick={onOpen} className="btn-primary p-2 rounded" title="Open lobby"><Play size={14} /></button>
        <button onClick={onDelete} className="btn-danger p-2 rounded" title="Delete lobby"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}
