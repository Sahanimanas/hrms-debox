// Which product the user is working in: Xeno HR (the HRMS at "/") or
// Xeno PM (project management at "/pm"). Both share one account and token;
// the choice only decides the post-login landing page and branding.
import { Users, KanbanSquare } from 'lucide-react';

export const WORKSPACES = {
  hr: {
    key: 'hr',
    name: 'Xeno HR',
    suffix: 'HR',
    tagline: 'Human Resource Management System',
    description: 'People, attendance, leave, payroll, performance and recruitment.',
    home: '/',
    icon: Users,
  },
  pm: {
    key: 'pm',
    name: 'Xeno Project Management',
    suffix: 'PM',
    tagline: 'Project & Work Management',
    description: 'Projects, boards, sprints, timelines, docs and team workload.',
    home: '/pm',
    icon: KanbanSquare,
  },
};

const STORAGE_KEY = 'workspace';

export const getWorkspace = () => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return WORKSPACES[value] ? value : null;
  } catch {
    return null;
  }
};

export const setWorkspace = (key) => {
  try {
    if (WORKSPACES[key]) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
};

export const workspaceHome = (key = getWorkspace()) => WORKSPACES[key]?.home || '/';

/** Workspace a path belongs to. */
export const workspaceOfPath = (pathname) => (pathname === '/pm' || pathname.startsWith('/pm/') ? 'pm' : 'hr');
