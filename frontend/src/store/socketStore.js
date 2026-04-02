import { create } from 'zustand';
import { io } from 'socket.io-client';

let socket = null;

export const useSocketStore = create((set, get) => ({
  socket: null,
  connected: false,
  onlineUsers: {}, // userId -> status

  connect: (token) => {
    if (socket?.connected) return;

    socket = io(import.meta.env.VITE_WS_URL || 'http://localhost:5000', {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      set({ socket, connected: true });
      console.log('[Socket] Connected');
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    socket.on('user:statusChange', ({ userId, status }) => {
      set(s => ({ onlineUsers: { ...s.onlineUsers, [userId]: status } }));
    });

    set({ socket });
  },

  disconnect: () => {
    socket?.disconnect();
    socket = null;
    set({ socket: null, connected: false });
  },

  getSocket: () => socket,
}));

export const getSocket = () => socket;
