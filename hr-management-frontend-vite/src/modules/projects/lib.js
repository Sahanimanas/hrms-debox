// Shared constants and helpers for Xeno PM (src/modules/projects).
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ChevronsUp, ArrowUp, Equal, ArrowDown, Minus, CheckSquare, Bug, BookOpen, Zap, GitBranch } from 'lucide-react';

export const API = '/v2/projects';

// Fired after a project is created / starred / renamed so the PM sidebar refreshes
export const PROJECTS_CHANGED = 'pm:projects-changed';
export const notifyProjectsChanged = () => window.dispatchEvent(new Event(PROJECTS_CHANGED));

export const PRIORITIES = {
  urgent: { label: 'Urgent', icon: ChevronsUp, cls: 'text-red-600', bg: 'bg-red-50 text-red-700' },
  high: { label: 'High', icon: ArrowUp, cls: 'text-orange-500', bg: 'bg-orange-50 text-orange-700' },
  medium: { label: 'Medium', icon: Equal, cls: 'text-amber-500', bg: 'bg-amber-50 text-amber-700' },
  low: { label: 'Low', icon: ArrowDown, cls: 'text-sky-500', bg: 'bg-sky-50 text-sky-700' },
  none: { label: 'No priority', icon: Minus, cls: 'text-slate-400', bg: 'bg-slate-100 text-slate-600' },
};
export const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low', 'none'];

export const TASK_TYPES = {
  task: { label: 'Task', icon: CheckSquare, cls: 'text-sky-600' },
  bug: { label: 'Bug', icon: Bug, cls: 'text-red-600' },
  story: { label: 'Story', icon: BookOpen, cls: 'text-emerald-600' },
  epic: { label: 'Epic', icon: Zap, cls: 'text-purple-600' },
  subtask: { label: 'Sub-task', icon: GitBranch, cls: 'text-slate-500' },
};

export const PROJECT_STATUS = {
  planning: { label: 'Planning', cls: 'bg-slate-100 text-slate-700' },
  active: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700' },
  on_hold: { label: 'On hold', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Completed', cls: 'bg-sky-100 text-sky-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-100 text-red-700' },
};

export const PROJECT_ROLES = {
  admin: { label: 'Project admin', hint: 'Manage settings, members and workflow' },
  member: { label: 'Member', hint: 'Create and edit tasks' },
  viewer: { label: 'Viewer', hint: 'Read and comment only' },
};

export const COLORS = ['#0f172a', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c'];

export const todayStr = () => format(new Date(), 'yyyy-MM-dd');
export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return format(d, 'yyyy-MM-dd');
};
export const parseDay = (dateStr) => new Date(`${dateStr}T12:00:00`);

export const fmtDate = (value, pattern = 'dd MMM yyyy') => {
  if (!value) return '—';
  const d = typeof value === 'string' && value.length === 10 ? parseDay(value) : new Date(value);
  return isNaN(d) ? '—' : format(d, pattern);
};

export const fromNow = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? '' : `${formatDistanceToNowStrict(d)} ago`;
};

export const isOverdue = (task) => !!task?.due_date && task.status_category !== 'done' && task.due_date < todayStr();

export const hours = (minutes) => {
  const h = (minutes || 0) / 60;
  return `${Math.round(h * 10) / 10}h`;
};

/** "1h 30m", "2h", "45m" -> minutes; plain numbers are hours. Returns null when invalid. */
export const parseDuration = (text) => {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round((parseFloat(m[1] || 0) * 60) + parseInt(m[2] || 0, 10));
};

export const errorText = (err, fallback = 'Something went wrong') => {
  const d = err?.response?.data;
  if (d?.errors?.length) return d.errors.map(e => e.message).join('; ');
  return typeof d?.detail === 'string' ? d.detail : fallback;
};

/** Position between two neighbours for drag & drop ordering. */
export const positionBetween = (before, after) => {
  if (before == null && after == null) return 1024;
  if (before == null) return after - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
};

export const statusMeta = (project, key) => project?.statuses?.find(s => s.key === key) || { key, label: key, color: '#64748b', category: 'todo' };

export const canEdit = (role) => role === 'admin' || role === 'member';

export const initials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const AVATAR_COLORS = ['bg-slate-700', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-600', 'bg-pink-500', 'bg-teal-500', 'bg-orange-500', 'bg-indigo-500'];
export const avatarColor = (seed) => AVATAR_COLORS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

/** Remember per-user UI choices (view, filters); never required for correctness. */
export const remember = {
  get: (key, fallback) => {
    try {
      const v = localStorage.getItem(`pm:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(`pm:${key}`, JSON.stringify(value));
    } catch { /* storage unavailable */ }
  },
};
