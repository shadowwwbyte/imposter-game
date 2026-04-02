import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

// Attach token on start
const stored = localStorage.getItem('imposter-auth');
if (stored) {
  try {
    const { state } = JSON.parse(stored);
    if (state?.accessToken) {
      api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`;
    }
  } catch {}
}

// Response interceptor for token refresh
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      try {
        const { useAuthStore } = await import('../store/authStore');
        const refreshed = await useAuthStore.getState().refreshAccessToken();
        if (refreshed) {
          original.headers['Authorization'] = api.defaults.headers.common['Authorization'];
          return api(original);
        }
      } catch {}
    }
    return Promise.reject(error);
  }
);

export default api;
