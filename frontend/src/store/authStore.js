import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../utils/api';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,

      login: async (identifier, password) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/auth/login', { identifier, password });
          set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken, isLoading: false });
          api.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
          return { success: true };
        } catch (err) {
          set({ isLoading: false });
          return { success: false, error: err.response?.data?.error || 'Login failed' };
        }
      },

      register: async (payload) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/auth/register', payload);
          set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken, isLoading: false });
          api.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
          return { success: true, message: data.message };
        } catch (err) {
          set({ isLoading: false });
          const errors = err.response?.data?.errors;
          const message = errors ? errors[0]?.msg : err.response?.data?.error || 'Registration failed';
          return { success: false, error: message };
        }
      },

      logout: async () => {
        try {
          await api.post('/auth/logout', { refreshToken: get().refreshToken });
        } catch {}
        delete api.defaults.headers.common['Authorization'];
        set({ user: null, accessToken: null, refreshToken: null });
      },

      refreshAccessToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const { data } = await api.post('/auth/refresh', { refreshToken });
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          api.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
          return true;
        } catch {
          set({ user: null, accessToken: null, refreshToken: null });
          return false;
        }
      },

      updateUser: (updates) => set(s => ({ user: { ...s.user, ...updates } })),

      setToken: (token) => {
        set({ accessToken: token });
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      },
    }),
    {
      name: 'imposter-auth',
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken }),
    }
  )
);

export const useThemeStore = create(
  persist(
    (set) => ({
      theme: 'dark',
      toggleTheme: () => set((s) => {
        const next = s.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.classList.toggle('light', next === 'light');
        document.documentElement.classList.toggle('dark', next === 'dark');
        return { theme: next };
      }),
      initTheme: () => {
        const stored = localStorage.getItem('imposter-theme');
        const theme = stored ? JSON.parse(stored)?.state?.theme : 'dark';
        document.documentElement.classList.toggle('light', theme === 'light');
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },
    }),
    { name: 'imposter-theme' }
  )
);
