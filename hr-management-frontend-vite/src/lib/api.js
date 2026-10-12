import axios from 'axios';
import { clearAuth } from '@/lib/auth';

// Use the backend URL from env when set; otherwise fall back to the relative
// `/api` path (works behind an Nginx proxy or the Vite dev-server proxy).
const BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;
const api = axios.create({
  baseURL: BACKEND_URL ? `${BACKEND_URL}/api` : '/api',
});

// Sign-in requests report their own errors inline (no redirect on 401)
const AUTH_FLOW = /\/auth\/(login|2fa\/verify|sso\/)/;

// Add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't redirect on the sign-in requests themselves — let the form show the
    // error inline so the page doesn't reload and clear the inputs.
    const isAuthFlow = AUTH_FLOW.test(error.config?.url || '');
    if (error.response?.status === 401 && !isAuthFlow) {
      clearAuth();
      // Tell the login page why (e.g. account deactivated / session revoked)
      const detail = error.response?.data?.error_code ? error.response.data.detail : null;
      try {
        if (detail) sessionStorage.setItem('login-notice', detail);
      } catch { /* storage unavailable */ }
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
