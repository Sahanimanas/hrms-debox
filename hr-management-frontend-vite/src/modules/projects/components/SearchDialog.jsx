import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { API } from '../lib';
import { ProjectDot } from './Shared';

/** Quick search across projects and tasks the user can see (Ctrl/Cmd + K). */
export default function SearchDialog({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ projects: [], tasks: [] });

  const searching = q.trim().length >= 2;

  useEffect(() => {
    if (!searching) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      api.get(`${API}/search`, { params: { q } }).then(r => alive && setResults(r.data)).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, searching]);

  const close = (next) => {
    if (!next) { setQ(''); setResults({ projects: [], tasks: [] }); }
    onOpenChange(next);
  };

  const go = (path) => {
    close(false);
    navigate(path);
  };

  const shown = searching ? results : { projects: [], tasks: [] };
  const empty = searching && !shown.projects.length && !shown.tasks.length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 px-4 border-b border-slate-200">
          <Search className="w-4 h-4 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects and tasks (title or key, e.g. WEB-12)…" className="flex-1 h-12 outline-none text-sm bg-transparent" data-testid="pm-search-input" />
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {shown.projects.length > 0 && <p className="px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Projects</p>}
          {shown.projects.map(p => (
            <button key={p.id} type="button" onClick={() => go(`/pm/projects/${p.id}`)} className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-100">
              <ProjectDot color={p.color} /><span className="text-sm font-medium text-slate-900">{p.name}</span><span className="text-xs text-slate-400">{p.key}</span>
            </button>
          ))}
          {shown.tasks.length > 0 && <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tasks</p>}
          {shown.tasks.map(t => (
            <button key={t.id} type="button" onClick={() => go(`/pm/projects/${t.project_id}?task=${t.id}`)} className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-100">
              <span className="text-xs font-medium text-slate-500 w-20 shrink-0">{t.key}</span>
              <span className={`text-sm truncate flex-1 ${t.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{t.title}</span>
              <span className="text-[11px] text-slate-400 shrink-0">{t.status_label}</span>
            </button>
          ))}
          {empty && <p className="text-sm text-slate-500 text-center py-6">No matches</p>}
          {!searching && <p className="text-xs text-slate-400 text-center py-6">Type at least 2 characters</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
