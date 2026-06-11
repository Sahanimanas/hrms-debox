// import axios from 'axios';
//
// const BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;
// const API_BASE = `${BACKEND_URL}/api`;
//
// const api = axios.create({
//   baseURL: API_BASE,
// });
//
// // Add auth token to requests
// api.interceptors.request.use(
//   (config) => {
//     const token = localStorage.getItem('token');
//     if (token) {
//       config.headers.Authorization = `Bearer ${token}`;
//     }
//     return config;
//   },
//   (error) => {
//     return Promise.reject(error);
//   }
// );
//
// // Handle 401 errors
// api.interceptors.response.use(
//   (response) => response,
//   (error) => {
//     if (error.response?.status === 401) {
//       localStorage.removeItem('token');
//       localStorage.removeItem('user');
//       window.location.href = '/login';
//     }
//     return Promise.reject(error);
//   }
// );
//
// export default api;

import axios from 'axios';

// Use the backend URL from env when set; otherwise fall back to the relative
// `/api` path (works behind an Nginx proxy or the Vite dev-server proxy).
const BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;
const api = axios.create({
  baseURL: BACKEND_URL ? `${BACKEND_URL}/api` : '/api',
});

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
    // Don't redirect on the login request itself — let the form show the
    // error inline so the page doesn't reload and clear the inputs.
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
