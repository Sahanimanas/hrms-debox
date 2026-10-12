import { clearPrivateCaches } from '@/lib/pwa';

export const setAuth = (token, user) => {
  // A new session must never see API responses cached for a previous user
  clearPrivateCaches();
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
};

export const getAuth = () => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  let user = null;
  try {
    user = userStr ? JSON.parse(userStr) : null;
  } catch {
    user = null;
  }
  return { token, user };
};

export const clearAuth = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // Drop the service worker's cached API data (NetworkFirst api-cache) on logout
  clearPrivateCaches();
};

export const isAuthenticated = () => {
  return !!localStorage.getItem('token');
};

/**
 * Permission check for UI (PL-5). `permissions` comes from GET /api/auth/me.
 * Admins always pass. The backend enforces the same rule; this only hides UI.
 */
export const hasPermission = (user, permissions, permission) => {
  if (user?.role === 'admin') return true;
  return Array.isArray(permissions) && permissions.includes(permission);
};
