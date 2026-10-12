import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderKanban, Plus, Star, Search, Lock, Globe, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { API, PROJECT_STATUS, fmtDate, errorText, notifyProjectsChanged } from '../lib';
import { useLoad, usePmMeta, usePeople } from '../hooks';
import { PageHeader, Loading, ErrorState, Empty, Avatar } from '../components/Shared';
import ProjectFormDialog from '../components/ProjectFormDialog';

/** All projects the user can see, with progress, filters and starring. */
export default function ProjectsPage() {
  const navigate = useNavigate();
  const meta = usePmMeta();
  const people = usePeople();
  const me = getAuth().user;
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload, setData } = useLoad(`${API}/projects${tab === 'archived' ? '?archived=true' : ''}`, 'Failed to load projects');

  const list = useMemo(() => {
    const items = (data || []).filter(p => !q || `${p.name} ${p.key} ${p.client || ''}`.toLowerCase().includes(q.toLowerCase()));
    if (tab === 'mine') return items.filter(p => p.lead_email === me?.email || (p.members || []).some(m => m.email === me?.email));
    if (tab === 'starred') return items.filter(p => p.favorite);
    return items;
  }, [data, q, tab, me?.email]);

  const star = async (e, p) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const r = await api.post(`${API}/projects/${p.id}/favorite`);
      setData(d => d.map(x => (x.id === p.id ? { ...x, favorite: r.data.favorite } : x)));
      notifyProjectsChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const personName = (email) => people.find(p => p.email === email)?.name || email;

  return (
    <div className="p-3 sm:p-4 md:p-8 max-w-7xl mx-auto space-y-5">
      <PageHeader icon={FolderKanban} title="Projects" subtitle="Every project you lead, belong to or can view">
        {meta?.can_create_projects && <Button className="gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={() => setCreating(true)} data-testid="new-project-btn"><Plus className="w-4 h-4" /> New project</Button>}
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-slate-100">
            <TabsTrigger value="active">All</TabsTrigger>
            <TabsTrigger value="mine">My projects</TabsTrigger>
            <TabsTrigger value="starred" className="gap-1"><Star className="w-3.5 h-3.5" /> Starred</TabsTrigger>
            <TabsTrigger value="archived" className="gap-1"><Archive className="w-3.5 h-3.5" /> Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, key or client" className="pl-9 bg-white" />
        </div>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : list.length === 0 ? (
        <Empty icon={FolderKanban} title={tab === 'archived' ? 'No archived projects' : 'No projects here yet'}>
          {meta?.can_create_projects && tab !== 'archived' && <Button size="sm" className="mt-2 bg-slate-800 hover:bg-slate-900" onClick={() => setCreating(true)}>Create a project</Button>}
        </Empty>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 text-left">
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold">Lead</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold w-48">Progress</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">Team</th>
              </tr>
            </thead>
            <tbody>
              {list.map(p => {
                const pct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;
                const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.active;
                return (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/pm/projects/${p.id}`)}>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={(e) => star(e, p)} aria-label="Star" className={p.favorite ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-500'}>
                        <Star className={`w-4 h-4 ${p.favorite ? 'fill-yellow-400' : ''}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link to={`/pm/projects/${p.id}`} className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ backgroundColor: p.color }}>{p.key.slice(0, 2)}</div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate flex items-center gap-1.5">{p.name}{p.visibility === 'private' ? <Lock className="w-3 h-3 text-slate-400" /> : <Globe className="w-3 h-3 text-slate-400" />}</p>
                          <p className="text-[11px] text-slate-500">{p.key} · <span className="capitalize">{p.methodology}</span>{p.client ? ` · ${p.client}` : ''}{p.my_role === 'viewer' ? ' · view only' : ''}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-1.5"><Avatar name={personName(p.lead_email)} size="xs" /><span className="truncate text-slate-700">{personName(p.lead_email)}</span></span></td>
                    <td className="px-3 py-2.5"><Badge className={`${st.cls} hover:opacity-90 text-[11px]`}>{st.label}</Badge></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2"><Progress value={pct} className="h-1.5 flex-1" /><span className="text-xs text-slate-500 w-9 text-right">{pct}%</span></div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{p.stats.done}/{p.stats.total} tasks{p.stats.overdue ? <span className="text-red-600"> · {p.stats.overdue} overdue</span> : null}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDate(p.due_date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex -space-x-1.5">
                        {(p.members || []).slice(0, 5).map(m => <Avatar key={m.email} name={m.name} size="sm" className="ring-2 ring-white" />)}
                        {(p.members || []).length > 5 && <span className="w-6 h-6 rounded-full bg-slate-100 ring-2 ring-white text-[10px] flex items-center justify-center text-slate-600">+{p.members.length - 5}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProjectFormDialog open={creating} onOpenChange={setCreating} onCreated={(p) => { notifyProjectsChanged(); navigate(`/pm/projects/${p.id}`); }} />
    </div>
  );
}
