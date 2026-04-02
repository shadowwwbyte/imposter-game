import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Sword, Users, MessageSquare, User, LogOut, Sun, Moon, Bell } from 'lucide-react';
import { useAuthStore, useThemeStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api from '../../utils/api';

export default function MainLayout() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { getSocket } = useSocketStore();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onFriendRequest = (data) => {
      toast(`📨 ${data.from.username} sent you a friend request!`);
      setNotifications(n => [...n, { type: 'friend_request', ...data }]);
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
    { to: '/games', icon: <Sword size={20} />, label: 'Games' },
    { to: '/friends', icon: <Users size={20} />, label: 'Friends' },
    { to: '/chat', icon: <MessageSquare size={20} />, label: 'Chat' },
    { to: '/profile', icon: <User size={20} />, label: 'Profile' },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside
        className="w-16 flex flex-col items-center py-4 gap-2 shrink-0"
        style={{ background: 'var(--bg1)', borderRight: '1px solid var(--bg3)' }}
      >
        {/* Logo */}
        <div className="mb-4 text-2xl cursor-pointer" onClick={() => navigate('/games')} title="Imposter Game">
          🕵️
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                clsx('nav-item w-10 h-10 flex items-center justify-center rounded-lg transition-all relative', {
                  'active': isActive,
                })
              }
            >
              {icon}
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="flex flex-col gap-1 items-center">
          <button
            onClick={toggleTheme}
            className="nav-item w-10 h-10 flex items-center justify-center rounded-lg"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Avatar + logout */}
          <div className="relative group">
            <button
              className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm border-2 transition-all"
              style={{ background: user?.avatar_color || '#458588', borderColor: 'var(--bg3)', color: '#282828' }}
              title={user?.username}
            >
              {user?.username?.[0]?.toUpperCase()}
            </button>
          </div>

          <button
            onClick={handleLogout}
            className="nav-item w-10 h-10 flex items-center justify-center rounded-lg"
            title="Logout"
            style={{ color: 'var(--red-b)' }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
