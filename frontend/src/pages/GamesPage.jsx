import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sword, Users, Clock, Copy, Trash2, LogIn, Play } from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const CATEGORIES = ['general','animals','food','sports','music','movies','technology','nature','history','geography','science','mythology','fashion','space','emotions','occupations','games'];

export default function GamesPage() {
  const { user } = useAuthStore();
  const { getSocket } = useSocketStore();
  const navigate = useNavigate();

  const [myLobbies, setMyLobbies]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode]     = useState('');
  const [createForm, setCreateForm] = useState({ name: '', maxPlayers: 10, turnTime: 30, wordCategory: 'general' });

  const fetchLobbies = async () => {
    try { const { data } = await api.get('/lobby/mine'); setMyLobbies(data); } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchLobbies(); }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => fetchLobbies();
    socket.on('lobby:reset', refresh);
    socket.on('lobby:discarded', refresh);
    return () => { socket.off('lobby:reset', refresh); socket.off('lobby:discarded', refresh); };
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
    try { await api.post(`/lobby/${code}/join`); navigate(`/games/lobby/${code}`); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed to join'); }
  };

  const discardLobby = async (code) => {
    if (!confirm('Discard this lobby?')) return;
    try { await api.delete(`/lobby/${code}`); setMyLobbies(l => l.filter(lb => lb.code !== code)); toast.success('Lobby discarded'); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const leaveLobby = async (code) => {
    try { await api.post(`/lobby/${code}/leave`); setMyLobbies(l => l.filter(lb => lb.code !== code)); toast.success('Left lobby'); }
    catch (err) { toast.error(err.response?.data?.error || 'Pause the game first'); }
  };

  const copyCode = (code) => {
    const url = `${window.location.origin}/games/lobby/${code}`;
    const fallback = () => {
      try {
        const el = document.createElement('textarea');
        el.value = url; el.style.position = 'fixed'; el.style.opacity = '0';
        document.body.appendChild(el); el.select();
        document.execCommand('copy'); document.body.removeChild(el);
        toast.success('Link copied!');
      } catch { toast.success(`Code: ${code}`); }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => toast.success('Link copied!')).catch(fallback);
    } else { fallback(); }
  };

  const activePlaying = myLobbies.filter(l => l.status === 'playing');
  const activePaused  = myLobbies.filter(l => l.status === 'paused');
  const waiting       = myLobbies.filter(l => l.status === 'waiting');

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch',
      color: 'var(--fg)',
      padding: '16px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8 }}>
        <div>
          <h1 style={{ fontFamily: 'VT323, monospace', fontSize: 36, color: 'var(--yellow-b, #fabd2f)', margin: 0 }}>GAMES</h1>
          <p style={{ fontSize: 11, color: 'var(--fg3)', margin: 0 }}>Create or join a lobby</p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}>
          <Plus size={15} /> New Lobby
        </button>
      </div>

      {/* Join */}
      <form onSubmit={joinLobby} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Lobby code (e.g. AB3X7K)" maxLength={6}
          className="grv-input"
          style={{ flex: 1, padding: '10px 14px', borderRadius: 8, fontSize: 16, textTransform: 'uppercase', letterSpacing: 4, fontWeight: 700 }} />
        <button type="submit" className="btn-primary"
          style={{ padding: '10px 16px', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <LogIn size={15} /> Join
        </button>
      </form>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createLobby} className="grv-panel" style={{ borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontWeight: 700, marginBottom: 12, color: 'var(--aqua-b)', fontSize: 14 }}>Create New Lobby</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>Lobby Name</label>
              <input className="grv-input" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }}
                placeholder="My Epic Lobby" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>Max Players</label>
                <input type="number" min={3} max={20} className="grv-input"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }}
                  value={createForm.maxPlayers} onChange={e => setCreateForm(f => ({ ...f, maxPlayers: +e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>Turn Time (s)</label>
                <input type="number" min={15} max={120} className="grv-input"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }}
                  value={createForm.turnTime} onChange={e => setCreateForm(f => ({ ...f, turnTime: +e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 6 }}>Word Category</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CATEGORIES.map(c => (
                  <button key={c} type="button"
                    onClick={() => setCreateForm(f => ({ ...f, wordCategory: c }))}
                    className={createForm.wordCategory === c ? 'btn-primary' : 'btn-ghost'}
                    style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                Create
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost"
                style={{ padding: '10px 16px', borderRadius: 8, fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--fg3)' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {activePlaying.length > 0 && <Section title="🎮 In Progress" color="var(--blue-b)" lobbies={activePlaying} user={user} navigate={navigate} onCopy={copyCode} onLeave={leaveLobby} onDiscard={discardLobby} />}
          {activePaused.length > 0  && <Section title="⏸ Paused"      color="var(--yellow-b, #fabd2f)" lobbies={activePaused}  user={user} navigate={navigate} onCopy={copyCode} onLeave={leaveLobby} onDiscard={discardLobby} desc="These games are paused. Tap to rejoin and resume." />}
          {waiting.length > 0       && <Section title="⏳ Waiting"     color="var(--green-b)"            lobbies={waiting}       user={user} navigate={navigate} onCopy={copyCode} onLeave={leaveLobby} onDiscard={discardLobby} />}
          {myLobbies.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--fg3)' }}>
              <Sword size={36} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
              <p>No lobbies yet.</p>
              <p style={{ fontSize: 12 }}>Create one or ask a friend for their lobby code.</p>
            </div>
          )}
        </div>
      )}

      {/* Bottom spacer so last card isn't hidden */}
      <div style={{ height: 16 }} />
    </div>
  );
}

function Section({ title, color, lobbies, user, navigate, onCopy, onLeave, onDiscard, desc }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color, marginBottom: 8 }}>{title}</div>
      {desc && <p style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 10, marginTop: -4 }}>{desc}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lobbies.map(lobby => <LobbyCard key={lobby.id} lobby={lobby} user={user} navigate={navigate} onCopy={onCopy} onLeave={onLeave} onDiscard={onDiscard} />)}
      </div>
    </div>
  );
}

function LobbyCard({ lobby, user, navigate, onCopy, onLeave, onDiscard }) {
  const isHost = lobby.host_id === user.id;
  const statusColor = { waiting: 'var(--green-b)', playing: 'var(--blue-b)', paused: 'var(--yellow-b, #fabd2f)' }[lobby.status] || 'var(--fg3)';
  const players = Array.isArray(lobby.players) ? lobby.players.filter(Boolean) : [];

  return (
    <div className="grv-panel" style={{ borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Code badge */}
        <div style={{
          fontFamily: 'VT323, monospace', fontSize: 20, letterSpacing: 3,
          color: 'var(--yellow-b, #fabd2f)', background: 'var(--bg)',
          padding: '4px 10px', borderRadius: 6, flexShrink: 0,
        }}>{lobby.code}</div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14, wordBreak: 'break-word' }}>{lobby.name}</span>
            {isHost && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(215,153,33,0.2)', color: 'var(--yellow)', border: '1px solid var(--yellow)', flexShrink: 0 }}>HOST</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Users size={11} /> {lobby.player_count}/{lobby.max_players}
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Clock size={11} /> {lobby.turn_time}s
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, textTransform: 'capitalize' }}>
              ● {lobby.status}
            </span>
          </div>
          {/* Player avatars */}
          {players.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
              {players.slice(0, 8).map(p => p && (
                <div key={p.id} title={p.username} style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: p.avatar_color || '#458588', color: '#282828',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}>
                  {p.username?.[0]?.toUpperCase()}
                </div>
              ))}
              {players.length > 8 && <span style={{ fontSize: 11, color: 'var(--fg3)', alignSelf: 'center' }}>+{players.length - 8}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => navigate(`/games/lobby/${lobby.code}`)} className="btn-primary"
          style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
          {lobby.status === 'paused' ? <><Play size={12} /> Resume</> : lobby.status === 'playing' ? <><Play size={12} /> Rejoin</> : <><LogIn size={12} /> Open</>}
        </button>
        <button onClick={() => onCopy(lobby.code)} className="btn-ghost"
          style={{ padding: '7px 10px', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Copy link">
          <Copy size={14} />
        </button>
        {isHost ? (
          <button onClick={() => onDiscard(lobby.code)} className="btn-ghost"
            style={{ padding: '7px 10px', borderRadius: 7, color: 'var(--red-b)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Discard">
            <Trash2 size={14} />
          </button>
        ) : (
          <button onClick={() => onLeave(lobby.code)} className="btn-ghost"
            style={{ padding: '7px 10px', borderRadius: 7, color: 'var(--orange-b)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Leave">
            <LogIn size={14} style={{ transform: 'scaleX(-1)' }} />
          </button>
        )}
      </div>
    </div>
  );
}
