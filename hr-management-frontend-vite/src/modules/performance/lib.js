// Shared helpers for the performance module pages.
import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';

export const PF = '/v2/performance';

export const apiError = (error, fallback = 'Something went wrong') => error?.response?.data?.detail || fallback;

export const currentUser = () => getAuth().user || {};
export const isLead = (user) => user?.role === 'admin' || user?.role === 'manager';

/** 'YYYY-MM-DD' or ISO → '12 Oct 2026' */
export const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  return isNaN(d) ? '—' : format(d, 'dd MMM yyyy');
};

export const fmtDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d) ? '—' : format(d, 'EEE, dd MMM yyyy · h:mm a');
};

export const todayStr = () => format(new Date(), 'yyyy-MM-dd');

/** <input type="datetime-local"> value ↔ ISO */
export const toLocalInput = (value) => (value ? format(new Date(value), "yyyy-MM-dd'T'HH:mm") : '');
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

/**
 * GET helper with loading / error state. `params` may be any JSON-serialisable object.
 * Pass path = null to skip loading. Params starting with "_" only bust the cache (not sent).
 */
export function useApi(path, params) {
  const key = JSON.stringify(params || {});
  const reqKey = path ? `${path}?${key}` : null;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ data: null, error: null, key: null, nonce: -1 });

  useEffect(() => {
    if (!reqKey) return undefined;
    let cancelled = false;
    api.get(path, { params: Object.fromEntries(Object.entries(JSON.parse(key)).filter(([k]) => !k.startsWith('_'))) })
      .then((r) => { if (!cancelled) setState({ data: r.data, error: null, key: reqKey, nonce }); })
      .catch((e) => { if (!cancelled) setState({ data: null, error: apiError(e, 'Failed to load'), key: reqKey, nonce }); });
    return () => { cancelled = true; };
  }, [path, key, reqKey, nonce]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  const current = !!reqKey && state.key === reqKey;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !!reqKey && (!current || state.nonce !== nonce),
    reload,
  };
}

export const GOAL_STATUS = {
  not_started: { label: 'Not started', tone: 'slate' },
  on_track: { label: 'On track', tone: 'emerald' },
  at_risk: { label: 'At risk', tone: 'amber' },
  behind: { label: 'Behind', tone: 'rose' },
  done: { label: 'Done', tone: 'blue' },
};

export const APPROVAL_STATUS = {
  draft: { label: 'Draft', tone: 'slate' },
  submitted: { label: 'Awaiting approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'emerald' },
  sent_back: { label: 'Sent back', tone: 'rose' },
};

export const CYCLE_STATUS = {
  draft: { label: 'Draft', tone: 'slate' },
  active: { label: 'Active', tone: 'emerald' },
  closed: { label: 'Closed', tone: 'purple' },
};

export const PHASES = ['setup', 'self_review', 'manager_review', 'peer_feedback', 'calibration', 'released'];
export const PHASE_LABELS = {
  setup: 'Setup',
  self_review: 'Self review',
  manager_review: 'Manager review',
  peer_feedback: '360° feedback',
  calibration: 'Calibration',
  released: 'Released',
};

export const REVIEW_STATUS = {
  pending: { label: 'Not started', tone: 'slate' },
  draft: { label: 'In progress', tone: 'amber' },
  submitted: { label: 'Submitted', tone: 'emerald' },
};

export const OBJECTIVE_STATUS = {
  not_started: { label: 'Not started', tone: 'slate' },
  in_progress: { label: 'In progress', tone: 'amber' },
  met: { label: 'Met', tone: 'emerald' },
  not_met: { label: 'Not met', tone: 'rose' },
};

export const PIP_OUTCOME = {
  successful: { label: 'Successful', tone: 'emerald' },
  extended: { label: 'Extended', tone: 'amber' },
  unsuccessful: { label: 'Unsuccessful', tone: 'rose' },
};

export const LEARNING_STATUS = {
  not_started: { label: 'Not started', tone: 'slate' },
  in_progress: { label: 'In progress', tone: 'amber' },
  completed: { label: 'Completed', tone: 'emerald' },
};

export const CERT_STATUS = {
  valid: { label: 'Valid', tone: 'emerald' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  expired: { label: 'Expired', tone: 'rose' },
};

export const TONES = {
  slate: 'bg-slate-100 text-slate-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
};

/** Heat-map colour for a 1–5 proficiency / rating */
export const heatClass = (value) => {
  if (value == null) return 'bg-slate-50 text-slate-300';
  if (value >= 4.5) return 'bg-emerald-600 text-white';
  if (value >= 3.5) return 'bg-emerald-400 text-white';
  if (value >= 2.5) return 'bg-amber-300 text-amber-950';
  if (value >= 1.5) return 'bg-orange-300 text-orange-950';
  return 'bg-rose-300 text-rose-950';
};

/** Default cycle: first active one, else the most recent. */
export const defaultCycleId = (cycles) => cycles?.find(c => c.status === 'active')?.id || cycles?.[0]?.id || '';
