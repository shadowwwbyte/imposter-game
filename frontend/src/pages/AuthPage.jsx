import { useState } from 'react';
import { useAuthStore, useThemeStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Sun, Moon, User, Mail, Lock, Sword, AlertCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // login | register-temp | register-full
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ identifier: '', username: '', email: '', password: '' });
  const { login, register } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();

  const update = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (mode === 'login') {
      const res = await login(form.identifier, form.password);
      if (res.success) {
        toast.success('Welcome back!');
        navigate('/games');
      } else {
        toast.error(res.error);
      }
    } else {
      const payload = {
        username: form.username,
        password: form.password,
        ...(mode === 'register-full' && { email: form.email }),
      };
      const res = await register(payload);
      if (res.success) {
        toast.success(res.message || 'Account created!');
        navigate('/games');
      } else {
        toast.error(res.error);
      }
    }
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Background grid */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'linear-gradient(var(--fg) 1px, transparent 1px), linear-gradient(90deg, var(--fg) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2 rounded btn-ghost"
        title="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="font-display text-7xl mb-2" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
            🕵️
          </div>
          <h1 className="font-display text-5xl tracking-widest" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
            IMPOSTER
          </h1>
          <p className="text-xs mt-1 tracking-widest" style={{ color: 'var(--fg3)' }}>
            WHO IS AMONG US?
          </p>
        </div>

        {/* Card */}
        <div className="grv-panel rounded-lg p-6 shadow-2xl" style={{ border: '1px solid var(--bg3)' }}>
          {/* Mode tabs */}
          {!forgotMode && (
            <div className="flex gap-1 mb-6 p-1 rounded" style={{ background: 'var(--bg)' }}>
              {[
                { id: 'login', label: 'Login' },
                { id: 'register-temp', label: 'Quick Account' },
                { id: 'register-full', label: 'Full Account' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setMode(tab.id)}
                  className={clsx(
                    'flex-1 py-2 px-2 rounded text-xs font-bold transition-all',
                    mode === tab.id
                      ? 'text-grv-bg'
                      : 'text-grv-fg3 hover:text-grv-fg'
                  )}
                  style={mode === tab.id ? { background: 'var(--yellow)', color: 'var(--bg)' } : {}}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Info banners */}
          {mode === 'register-temp' && (
            <div className="mb-4 p-3 rounded flex gap-2 text-xs" style={{ background: 'rgba(215,153,33,0.1)', border: '1px solid var(--yellow)', color: 'var(--yellow-b, #fabd2f)' }}>
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>Temporary account — expires in 30 days. Add email anytime to make it permanent.</span>
            </div>
          )}

          {forgotMode && (
            <div className="mb-4">
              <h2 className="font-bold text-lg mb-1" style={{ color: 'var(--fg)' }}>Reset Password</h2>
              <p className="text-xs" style={{ color: 'var(--fg3)' }}>Enter your email to receive a reset link.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Login: identifier (username or email) */}
            {mode === 'login' && !forgotMode && (
              <Field icon={<User size={15} />} placeholder="Username or email" value={form.identifier} onChange={update('identifier')} />
            )}

            {/* Register: username */}
            {(mode === 'register-temp' || mode === 'register-full') && (
              <Field icon={<User size={15} />} placeholder="Username (3-32 chars, a-z 0-9 _)" value={form.username} onChange={update('username')} />
            )}

            {/* Forgot / Full register: email */}
            {(forgotMode || mode === 'register-full') && (
              <Field icon={<Mail size={15} />} placeholder="Email address" type="email" value={form.email} onChange={update('email')} />
            )}

            {/* Password */}
            {!forgotMode && (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg3)' }}>
                  <Lock size={15} />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password (min 6 chars)"
                  value={form.password}
                  onChange={update('password')}
                  required
                  className="grv-input w-full py-2.5 pl-9 pr-10 rounded text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--fg3)' }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 rounded font-bold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">◌</span>
                  {forgotMode ? 'Sending...' : mode === 'login' ? 'Logging in...' : 'Creating...'}
                </span>
              ) : (
                forgotMode ? 'Send Reset Link' : mode === 'login' ? '→ Login' : '→ Create Account'
              )}
            </button>
          </form>

          {/* Forgot password link */}
          {mode === 'login' && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setForgotMode(v => !v)}
                className="text-xs hover:underline"
                style={{ color: 'var(--fg3)' }}
              >
                {forgotMode ? '← Back to login' : 'Forgot password?'}
              </button>
            </div>
          )}

          {/* Sword decoration */}
          <div className="mt-6 pt-4 border-t flex items-center justify-center gap-3" style={{ borderColor: 'var(--bg3)' }}>
            <Sword size={14} style={{ color: 'var(--fg3)' }} />
            <span className="text-xs" style={{ color: 'var(--fg3)' }}>
              {mode === 'login' ? 'New here? Pick a tab above' : 'Already have an account? Click Login'}
            </span>
            <Sword size={14} style={{ color: 'var(--fg3)', transform: 'scaleX(-1)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, placeholder, value, onChange, type = 'text' }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg3)' }}>{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required
        className="grv-input w-full py-2.5 pl-9 pr-3 rounded text-sm"
      />
    </div>
  );
}
