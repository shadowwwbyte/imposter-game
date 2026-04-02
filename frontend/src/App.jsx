import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore, useThemeStore } from './store/authStore';
import { useSocketStore } from './store/socketStore';

import AuthPage from './pages/AuthPage';
import MainLayout from './components/layout/MainLayout';
import GamesPage from './pages/GamesPage';
import FriendsPage from './pages/FriendsPage';
import ChatPage from './pages/ChatPage';
import ProfilePage from './pages/ProfilePage';
import LobbyPage from './pages/LobbyPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

function PrivateRoute({ children }) {
  const { user } = useAuthStore();
  return user ? children : <Navigate to="/auth" replace />;
}

export default function App() {
  const { user, accessToken } = useAuthStore();
  const { connect, disconnect } = useSocketStore();
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
  }, []);

  useEffect(() => {
    if (user && accessToken) {
      connect(accessToken);
    } else {
      disconnect();
    }
    return () => {};
  }, [user, accessToken]);

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--bg1)',
            color: 'var(--fg)',
            border: '1px solid var(--bg3)',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#b8bb26', secondary: '#282828' } },
          error: { iconTheme: { primary: '#fb4934', secondary: '#282828' } },
        }}
      />

      <Routes>
        <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

        <Route path="/" element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }>
          <Route index element={<Navigate to="/games" replace />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="games/lobby/:code" element={<LobbyPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:userId" element={<ChatPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
