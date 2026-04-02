import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';

export default function VerifyEmailPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // verifying | success | error

  useEffect(() => {
    api.get(`/auth/verify-email/${token}`)
      .then(() => { setStatus('success'); setTimeout(() => navigate('/auth'), 3000); })
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <div className="text-center p-8">
        <div className="font-display text-5xl mb-4">🕵️</div>
        {status === 'verifying' && <p style={{ color: 'var(--fg3)' }}>Verifying your email...</p>}
        {status === 'success' && (
          <>
            <h2 className="font-bold text-xl mb-2" style={{ color: 'var(--green-b)' }}>✓ Email Verified!</h2>
            <p style={{ color: 'var(--fg3)' }}>Your account is now permanent. Redirecting to login...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h2 className="font-bold text-xl mb-2" style={{ color: 'var(--red-b)' }}>✗ Invalid Link</h2>
            <p style={{ color: 'var(--fg3)' }}>This verification link is invalid or expired.</p>
            <button onClick={() => navigate('/auth')} className="btn-primary mt-4 px-4 py-2 rounded text-sm">
              Go to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
