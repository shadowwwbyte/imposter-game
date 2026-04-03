import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Sword, Users, MessageSquare, User, LogOut, Sun, Moon } from 'lucide-react';
import { useAuthStore, useThemeStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
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

  const navItems = [
    { to: '/games',   icon: <Sword size={20} />,         label: 'Games'   },
    { to: '/friends', icon: <Users size={20} />,         label: 'Friends', badge: notifCount },
    { to: '/chat',    icon: <MessageSquare size={20} />, label: 'Chat'    },
    { to: '/profile', icon: <User size={20} />,          label: 'Profile' },
  ];

  // Hide bottom nav inside a lobby (full-screen game UI)
  const inLobby = location.pathname.includes('/games/lobby/');

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Desktop sidebar (hidden on mobile) ───────────────────────────── */}
      <aside
        className="hidden md:flex w-16 flex-col items-center py-4 gap-2 shrink-0"
        style={{ background: 'var(--bg1)', borderRight: '1px solid var(--bg3)' }}
      >
        <div className="mb-4 text-2xl cursor-pointer" onClick={() => navigate('/games')}>🕵️</div>

        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ to, icon, label, badge }) => (
            <NavLink key={to} to={to} title={label}
              className={({ isActive }) =>
                clsx('nav-item w-10 h-10 flex items-center justify-center rounded-lg transition-all relative',
                  isActive && 'active')
              }
            >
              {icon}
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold"
                  style={{ background: 'var(--red)', color: 'var(--fg)', fontSize: 9 }}>
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col gap-1 items-center">
          <button onClick={toggleTheme} className="nav-item w-10 h-10 flex items-center justify-center rounded-lg"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm border-2"
            onClick={() => navigate('/profile')}
            style={{ background: user?.avatar_color || '#458588', borderColor: 'var(--bg3)', color: '#282828' }}
            title={user?.username}>
            {user?.username?.[0]?.toUpperCase()}
          </button>
          <button onClick={handleLogout} className="nav-item w-10 h-10 flex items-center justify-center rounded-lg"
            title="Logout" style={{ color: 'var(--red-b)' }}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className={clsx('flex-1 overflow-hidden flex flex-col', !inLobby && 'md:pb-0 pb-16')}>
        <Outlet />
      </main>

      {/* ── Mobile bottom nav (hidden on desktop, hidden inside lobby) ───── */}
      {!inLobby && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around px-2 py-1"
          style={{
            background: 'var(--bg1)',
            borderTop: '1px solid var(--bg3)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            minHeight: 56,
          }}
        >
          {navItems.map(({ to, icon, label, badge }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                clsx('flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all relative',
                  isActive
                    ? 'text-yellow-400'
                    : 'text-grv-fg3'
                )
              }
              style={({ isActive }) => ({ color: isActive ? 'var(--yellow-b, #fabd2f)' : 'var(--fg3)' })}
            >
              <div className="relative">
                {icon}
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold"
                    style={{ background: 'var(--red)', color: 'var(--fg)', fontSize: 9 }}>
                    {badge}
                  </span>
                )}
              </div>
              <span className="text-xs font-bold" style={{ fontSize: 10 }}>{label}</span>
            </NavLink>
          ))}

          {/* Theme toggle in bottom nav */}
          <button onClick={toggleTheme}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg"
            style={{ color: 'var(--fg3)' }}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            <span style={{ fontSize: 10 }} className="font-bold">Theme</span>
          </button>
        </nav>
      )}
    </div>
  );
}
