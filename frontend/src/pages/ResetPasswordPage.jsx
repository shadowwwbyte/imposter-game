import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.success('Password reset! Please login.');
      navigate('/auth');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <div className="w-full max-w-sm p-6 grv-panel rounded-xl">
        <div className="text-center mb-6">
          <div className="font-display text-4xl mb-2">🕵️</div>
          <h2 className="font-bold text-lg">Reset Password</h2>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            placeholder="New password (min 6 chars)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={6}
            required
            className="grv-input w-full py-2.5 px-3 rounded text-sm"
          />
          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 rounded font-bold text-sm disabled:opacity-60">
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
