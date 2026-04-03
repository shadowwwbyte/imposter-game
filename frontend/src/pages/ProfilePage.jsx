import { useState, useEffect } from 'react';
import { Shield, Sword, Trophy, Target, AlertCircle, LogOut } from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const COLORS = ['#458588','#cc241d','#98971a','#d79921','#689d6a','#b16286','#427b58','#d65d0e','#83a598','#fb4934','#b8bb26','#fabd2f','#8ec07c','#d3869b','#a89984','#fe8019'];

export default function ProfilePage() {
  const { user, updateUser, logout } = useAuthStore();
  const navigate = useNavigate();
  const [profile, setProfile]       = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmail, setShowEmail]   = useState(false);

  useEffect(() => { api.get('/users/me').then(({ data }) => setProfile(data)).catch(() => {}); }, []);

  const updateColor = async (color) => {
    try { await api.patch('/users/me', { avatarColor: color }); updateUser({ avatar_color: color }); toast.success('Updated!'); } catch {}
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    try { await api.post('/auth/add-email', { email: emailInput }); toast.success('Verification email sent!'); setShowEmail(false); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const handleLogout = async () => { await logout(); navigate('/auth'); toast.success('Logged out!'); };

  const p = profile || user;
  if (!p) return <div style={{ padding: 24, color: 'var(--fg3)' }}>Loading...</div>;

  const winRate = p.total_games > 0 ? Math.round((p.games_won / p.total_games) * 100) : 0;
  const impWR   = p.times_imposter > 0 ? Math.round((p.imposter_wins / p.times_imposter) * 100) : 0;

  return (
    <div style={{
      height: '100%', overflowY: 'auto', overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch', color: 'var(--fg)', padding: 16,
    }}>
      <h1 style={{ fontFamily: 'VT323, monospace', fontSize: 36, color: 'var(--yellow-b, #fabd2f)', margin: '0 0 16px' }}>PROFILE</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>

        {/* User card */}
        <div className="grv-panel" style={{ borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 14, flexShrink: 0,
              background: user.avatar_color || '#458588', color: '#282828',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 28,
            }}>
              {p.username?.[0]?.toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 20, wordBreak: 'break-word' }}>{p.username}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {p.email && (
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--bg2)', color: 'var(--fg3)' }}>
                    📧 {p.email}
                  </span>
                )}
                <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 700,
                  background: p.is_temporary ? 'rgba(204,36,29,0.15)' : 'rgba(69,133,136,0.15)',
                  color: p.is_temporary ? 'var(--red-b)' : 'var(--blue-b)',
                  border: `1px solid ${p.is_temporary ? 'var(--red)' : 'var(--blue)'}`,
                }}>
                  {p.is_temporary ? '⏳ Temporary' : '✓ Permanent'}
                </span>
              </div>
            </div>
          </div>

          {p.is_temporary && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(215,153,33,0.1)', border: '1px solid var(--yellow)', color: 'var(--yellow-b, #fabd2f)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Temporary Account</div>
                  {p.expires_at && <div>Expires: {new Date(p.expires_at).toLocaleDateString()}</div>}
                  <button onClick={() => setShowEmail(v => !v)} style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginTop: 4, fontSize: 12 }}>
                    Add email to keep account permanently →
                  </button>
                </div>
              </div>
              {showEmail && (
                <form onSubmit={submitEmail} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input type="email" required value={emailInput} onChange={e => setEmailInput(e.target.value)}
                    placeholder="your@email.com" className="grv-input"
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 16 }} />
                  <button type="submit" className="btn-primary" style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}>Add</button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grv-panel" style={{ borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontWeight: 700, color: 'var(--aqua-b)', fontSize: 13 }}>
            <Trophy size={15} /> Statistics
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total Games',   value: p.total_games || 0,  icon: <Target size={15} />, color: 'var(--blue-b)' },
              { label: 'Win Rate',      value: `${winRate}%`,        icon: <Trophy size={15} />, color: 'var(--yellow-b, #fabd2f)' },
              { label: 'As Imposter',   value: p.times_imposter || 0, icon: <Sword size={15} />, color: 'var(--red-b)' },
              { label: 'Imposter WR',   value: `${impWR}%`,          icon: <Shield size={15} />, color: 'var(--green-b)' },
            ].map(stat => (
              <div key={stat.label} style={{ textAlign: 'center', padding: 14, borderRadius: 8, background: 'var(--bg)' }}>
                <div style={{ color: stat.color, display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{stat.icon}</div>
                <div style={{ fontFamily: 'VT323, monospace', fontSize: 32, color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Avatar */}
        <div className="grv-panel" style={{ borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--aqua-b)', fontSize: 13, marginBottom: 12 }}>Avatar Color</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {COLORS.map(color => (
              <button key={color} onClick={() => updateColor(color)} style={{
                width: 40, height: 40, borderRadius: 8, background: color, border: 'none', cursor: 'pointer',
                outline: user.avatar_color === color ? '3px solid var(--yellow)' : '2px solid transparent',
                outlineOffset: 2, transition: 'transform 0.15s',
              }} />
            ))}
          </div>
        </div>

        {/* Logout card — visible on mobile where sidebar is hidden */}
        <div className="grv-panel" style={{ borderRadius: 12, padding: 16 }}>
          <button onClick={handleLogout} style={{
            width: '100%', padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 700,
            background: 'rgba(204,36,29,0.15)', color: 'var(--red-b)',
            border: '1px solid var(--red)', cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}
