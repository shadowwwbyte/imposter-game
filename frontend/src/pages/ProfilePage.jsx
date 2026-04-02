import { useState, useEffect } from 'react';
import { Shield, Sword, Trophy, Target, Mail, Clock, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

const AVATAR_COLORS = ['#458588','#cc241d','#98971a','#d79921','#689d6a','#b16286','#427b58','#d65d0e','#83a598','#fb4934','#b8bb26','#fabd2f','#8ec07c','#d3869b','#a89984','#fe8019'];

export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [addEmailForm, setAddEmailForm] = useState('');
  const [showAddEmail, setShowAddEmail] = useState(false);

  useEffect(() => {
    api.get('/users/me').then(({ data }) => setProfile(data)).catch(() => {});
  }, []);

  const updateColor = async (color) => {
    try {
      await api.patch('/users/me', { avatarColor: color });
      updateUser({ avatar_color: color });
      toast.success('Avatar updated!');
    } catch {}
  };

  const submitAddEmail = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/add-email', { email: addEmailForm });
      toast.success('Verification email sent!');
      setShowAddEmail(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const p = profile || user;
  if (!p) return <div className="p-6" style={{ color: 'var(--fg3)' }}>Loading...</div>;

  const winRate = p.total_games > 0 ? Math.round((p.games_won / p.total_games) * 100) : 0;
  const imposterWinRate = p.times_imposter > 0 ? Math.round((p.imposter_wins / p.times_imposter) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ color: 'var(--fg)' }}>
      <h1 className="font-display text-4xl mb-6" style={{ color: 'var(--yellow-b, #fabd2f)' }}>PROFILE</h1>

      <div className="max-w-2xl space-y-6">
        {/* User card */}
        <div className="grv-panel rounded-lg p-6">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl flex items-center justify-center font-bold text-3xl"
              style={{ background: user.avatar_color || '#458588', color: '#282828' }}>
              {p.username?.[0]?.toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{p.username}</h2>
              <div className="flex gap-2 mt-1 flex-wrap">
                {p.email ? (
                  <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg2)', color: 'var(--fg3)' }}>
                    📧 {p.email}
                  </span>
                ) : null}
                <span className={`text-xs px-2 py-1 rounded font-bold ${p.is_temporary ? 'tag-imposter' : 'tag-innocent'}`}>
                  {p.is_temporary ? '⏳ Temporary' : '✓ Permanent'}
                </span>
                {p.email_verified && (
                  <span className="text-xs px-2 py-1 rounded tag-innocent">✓ Verified</span>
                )}
              </div>
            </div>
          </div>

          {/* Temp account warning */}
          {p.is_temporary && (
            <div className="mt-4 p-3 rounded flex gap-2" style={{ background: 'rgba(215,153,33,0.1)', border: '1px solid var(--yellow)', color: 'var(--yellow-b, #fabd2f)' }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-bold mb-1">Temporary Account</div>
                {p.expires_at && <div>Expires: {new Date(p.expires_at).toLocaleDateString()}</div>}
                <button onClick={() => setShowAddEmail(v => !v)} className="underline mt-1">Add email to keep account permanently →</button>
              </div>
            </div>
          )}

          {showAddEmail && (
            <form onSubmit={submitAddEmail} className="mt-3 flex gap-2">
              <input
                type="email" required
                value={addEmailForm}
                onChange={e => setAddEmailForm(e.target.value)}
                placeholder="your@email.com"
                className="grv-input flex-1 py-2 px-3 rounded text-sm"
              />
              <button type="submit" className="btn-primary px-3 py-2 rounded text-sm">Add</button>
            </form>
          )}
        </div>

        {/* Stats */}
        <div className="grv-panel rounded-lg p-5">
          <h3 className="font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--aqua-b)' }}>
            <Trophy size={16} /> Statistics
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Games', value: p.total_games || 0, icon: <Target size={16} />, color: 'var(--blue-b)' },
              { label: 'Win Rate', value: `${winRate}%`, icon: <Trophy size={16} />, color: 'var(--yellow-b, #fabd2f)' },
              { label: 'As Imposter', value: p.times_imposter || 0, icon: <Sword size={16} />, color: 'var(--red-b)' },
              { label: 'Imposter WR', value: `${imposterWinRate}%`, icon: <Shield size={16} />, color: 'var(--green-b)' },
            ].map(stat => (
              <div key={stat.label} className="text-center p-3 rounded" style={{ background: 'var(--bg)' }}>
                <div className="flex justify-center mb-1" style={{ color: stat.color }}>{stat.icon}</div>
                <div className="font-display text-3xl" style={{ color: stat.color }}>{stat.value}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--fg3)' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Avatar color picker */}
        <div className="grv-panel rounded-lg p-5">
          <h3 className="font-bold mb-4" style={{ color: 'var(--aqua-b)' }}>Avatar Color</h3>
          <div className="flex flex-wrap gap-3">
            {AVATAR_COLORS.map(color => (
              <button
                key={color}
                onClick={() => updateColor(color)}
                className="w-10 h-10 rounded-lg transition-transform hover:scale-110"
                style={{
                  background: color,
                  outline: user.avatar_color === color ? '3px solid var(--yellow)' : '2px solid transparent',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
