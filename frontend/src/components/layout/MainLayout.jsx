import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Sword, Users, MessageSquare, User, LogOut, Sun, Moon } from 'lucide-react';
import { useAuthStore, useThemeStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export default function MainLayout() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { getSocket } = useSocketStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onFriendRequest = (data) => {
      toast(`📨 ${data.from.username} sent you a friend request!`);
      setNotifCount(n => n + 1);
    };
    socket.on('friend:request', onFriendRequest);
    return () => socket.off('friend:request', onFriendRequest);
  }, [getSocket]);

  const handleLogout = async () => {
    await logout();
    navigate('/auth');
    toast.success('Logged out!');
  };

  const inLobby = location.pathname.includes('/games/lobby/');

  const navItems = [
    { to: '/games',   icon: <Sword size={22} />,         label: 'Games'   },
    { to: '/friends', icon: <Users size={22} />,         label: 'Friends', badge: notifCount },
    { to: '/chat',    icon: <MessageSquare size={22} />, label: 'Chat'    },
    { to: '/profile', icon: <User size={22} />,          label: 'Profile' },
  ];

  return (
    <div style={{ display: 'flex', height: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Desktop sidebar ── */}
      <aside style={{
        display: 'none',
        width: 64,
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        gap: 8,
        flexShrink: 0,
        background: 'var(--bg1)',
        borderRight: '1px solid var(--bg3)',
      }}
        className="md-sidebar"
      >
        <style>{`
          @media (min-width: 768px) {
            .md-sidebar { display: flex !important; }
            .mobile-bottom-nav { display: none !important; }
            .main-content { padding-bottom: 0 !important; }
          }
        `}</style>

        <div style={{ fontSize: 24, cursor: 'pointer', marginBottom: 16 }} onClick={() => navigate('/games')}>🕵️</div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {navItems.map(({ to, icon, label, badge }) => (
            <NavLink key={to} to={to} title={label} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 8, position: 'relative',
              color: isActive ? 'var(--yellow-b, #fabd2f)' : 'var(--fg3)',
              background: isActive ? 'var(--bg2)' : 'transparent',
              textDecoration: 'none', transition: 'all 0.15s',
            })}>
              {icon}
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--red)', color: 'var(--fg)',
                  fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                }}>{badge}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <button onClick={toggleTheme} title="Toggle theme" style={{
            width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--fg3)', background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={() => navigate('/profile')} style={{
            width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: user?.avatar_color || '#458588', color: '#282828', fontWeight: 700, fontSize: 14,
            border: '2px solid var(--bg3)', cursor: 'pointer',
          }} title={user?.username}>
            {user?.username?.[0]?.toUpperCase()}
          </button>
          <button onClick={handleLogout} title="Logout" style={{
            width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--red-b)', background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <main className="main-content" style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        // Reserve space for bottom nav on mobile
        paddingBottom: inLobby ? 0 : 'calc(60px + env(safe-area-inset-bottom))',
      }}>
        <Outlet />
      </main>

      {/* ── Mobile bottom nav ── */}
      {!inLobby && (
        <nav className="mobile-bottom-nav" style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'stretch',
          background: 'var(--bg1)',
          borderTop: '1px solid var(--bg3)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {navItems.map(({ to, icon, label, badge }) => (
            <NavLink key={to} to={to} style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              padding: '10px 4px',
              textDecoration: 'none',
              color: isActive ? 'var(--yellow-b, #fabd2f)' : 'var(--fg3)',
              borderTop: isActive ? '2px solid var(--yellow)' : '2px solid transparent',
              transition: 'all 0.15s',
              position: 'relative',
            })}>
              <div style={{ position: 'relative' }}>
                {icon}
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--red)', color: 'var(--fg)',
                    fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                  }}>{badge}</span>
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{label}</span>
            </NavLink>
          ))}

          {/* Theme toggle */}
          <button onClick={toggleTheme} style={{
            flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, padding: '10px 4px',
            color: 'var(--fg3)', background: 'transparent', border: 'none',
            borderTop: '2px solid transparent', cursor: 'pointer',
          }}>
            {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>Theme</span>
          </button>

          {/* Logout */}
          <button onClick={handleLogout} style={{
            flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, padding: '10px 4px',
            color: 'var(--red-b)', background: 'transparent', border: 'none',
            borderTop: '2px solid transparent', cursor: 'pointer',
          }}>
            <LogOut size={22} />
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>Logout</span>
          </button>
        </nav>
      )}
    </div>
  );
}
