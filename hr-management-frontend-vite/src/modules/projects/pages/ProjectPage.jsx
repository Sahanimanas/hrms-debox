import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { KanbanSquare, List, CalendarDays, GanttChart, Rocket, Diamond, FileText, BarChart3, Activity, Settings2, Plus, Star, Search, X, Lock, Globe, ArrowLeft, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { API, PROJECT_STATUS, PRIORITIES, PRIORITY_ORDER, TASK_TYPES, errorText, canEdit, notifyProjectsChanged, remember } from '../lib';
import { usePeople } from '../hooks';
import { Loading, ErrorState, Avatar } from '../components/Shared';
import TaskDrawer from '../components/TaskDrawer';
import NewTaskDialog from '../components/NewTaskDialog';
import BoardView from '../components/views/BoardView';
import ListView from '../components/views/ListView';
import CalendarView from '../components/views/CalendarView';
import TimelineView from '../components/views/TimelineView';
import SprintsTab from './project/SprintsTab';
import MilestonesTab from './project/MilestonesTab';
import DocsTab from './project/DocsTab';
import ReportsTab from './project/ReportsTab';
import ActivityTab from './project/ActivityTab';
import SettingsTab from './project/SettingsTab';

const VIEWS = [
  { key: 'board', label: 'Board', icon: KanbanSquare, tasks: true },
  { key: 'list', label: 'List', icon: List, tasks: true },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, tasks: true },
  { key: 'timeline', label: 'Timeline', icon: GanttChart, tasks: true },
  { key: 'sprints', label: 'Backlog & Sprints', icon: Rocket },
  { key: 'milestones', label: 'Milestones', icon: Diamond },
  { key: 'docs', label: 'Docs', icon: FileText },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

const ALL = '__all';
const EMPTY_FILTERS = { q: '', assignee: ALL, priority: ALL, type: ALL, label: ALL, hideDone: false, sprint: ALL };

/** One project: Board / List / Calendar / Timeline views plus sprints, milestones, docs, reports and settings. */
export default function ProjectPage() {
  const { id } = useParams();
  // Fresh state per project
  return <ProjectView key={id} id={id} />;
}

function ProjectView({ id }) {
  const [params, setParams] = useSearchParams();
  const people = usePeople();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [holidays, setHolidays] = useState({});
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [creating, setCreating] = useState(null); // defaults object when open

  const view = VIEWS.some(v => v.key === params.get('view')) ? params.get('view') : remember.get(`view:${id}`, 'board');
  const openTaskId = params.get('task');

  const setView = (v) => {
    remember.set(`view:${id}`, v);
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };
  const setOpenTask = useCallback((taskId) => {
    setParams(p => {
      const next = new URLSearchParams(p);
      if (taskId) next.set('task', taskId); else next.delete('task');
      return next;
    }, { replace: !taskId });
  }, [setParams]);

  const loadProject = useCallback(() => api.get(`${API}/projects/${id}`)
    .then(r => { setProject(r.data); setError(null); })
    .catch(err => setError(errorText(err, 'Failed to load project'))), [id]);

  const loadTasks = useCallback(() => Promise.all([
    api.get(`${API}/projects/${id}/tasks`),
    api.get(`${API}/projects/${id}/sprints`),
    api.get(`${API}/projects/${id}/milestones`),
  ])
    .then(([t, s, m]) => { setTasks(t.data); setSprints(s.data); setMilestones(m.data); })
    .catch(err => toast.error(errorText(err, 'Failed to load tasks'))), [id]);

  useEffect(() => {
    loadProject();
    loadTasks();
  }, [loadProject, loadTasks]);

  // HR holidays shade the calendar
  useEffect(() => {
    api.get('/holidays').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.holidays || []);
      setHolidays(Object.fromEntries(list.filter(h => h.date).map(h => [String(h.date).slice(0, 10), h.name || h.title || 'Holiday'])));
    }).catch(() => {});
  }, []);

  const activeSprint = sprints.find(s => s.status === 'active');
  const isScrum = project?.methodology === 'scrum';

  // Scrum boards default to the active sprint
  const sprintFilter = filters.sprint === ALL && isScrum && view === 'board' && activeSprint ? activeSprint.id : filters.sprint;

  const filtered = useMemo(() => tasks.filter(t => {
    if (filters.q && !`${t.key} ${t.title}`.toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.assignee !== ALL) {
      if (filters.assignee === '__none' ? t.assignee_email : t.assignee_email !== filters.assignee) return false;
    }
    if (filters.priority !== ALL && t.priority !== filters.priority) return false;
    if (filters.type !== ALL && t.type !== filters.type) return false;
    if (filters.label !== ALL && !(t.label_ids || []).includes(filters.label)) return false;
    if (filters.hideDone && t.status_category === 'done') return false;
    if (sprintFilter === '__backlog' && t.sprint_id) return false;
    if (sprintFilter !== ALL && sprintFilter !== '__backlog' && t.sprint_id !== sprintFilter) return false;
    return true;
  }), [tasks, filters, sprintFilter]);

  const refresh = useCallback(() => { loadTasks(); }, [loadTasks]);
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const filterCount = Object.entries(filters).filter(([k, v]) => v !== EMPTY_FILTERS[k]).length;

  const star = async () => {
    try {
      const r = await api.post(`${API}/projects/${id}/favorite`);
      setProject(p => ({ ...p, favorite: r.data.favorite }));
      notifyProjectsChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (error) return <div className="p-6"><ErrorState message={error} onRetry={loadProject} /><div className="text-center"><Link to="/pm/projects" className="text-sm text-slate-600 hover:underline">Back to projects</Link></div></div>;
  if (!project) return <div className="p-6"><Loading /></div>;

  const editable = canEdit(project.my_role) && !project.archived;
  const st = PROJECT_STATUS[project.status] || PROJECT_STATUS.active;
  const current = VIEWS.find(v => v.key === view);
  const members = (project.members || []).filter(m => m.active !== false);

  return (
    <div className="p-3 sm:p-4 md:px-6 md:py-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/pm/projects" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-white" aria-label="Back"><ArrowLeft className="w-4 h-4" /></Link>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 shadow" style={{ backgroundColor: project.color }}>{project.key.slice(0, 2)}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate" style={{ fontFamily: 'Plus Jakarta Sans' }} data-testid="project-title">{project.name}</h1>
              <button type="button" onClick={star} aria-label="Star" className={project.favorite ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-500'}><Star className={`w-5 h-5 ${project.favorite ? 'fill-yellow-400' : ''}`} /></button>
              <Badge className={`${st.cls} hover:opacity-90 text-[11px]`}>{st.label}</Badge>
              {project.archived && <Badge className="bg-slate-200 text-slate-700 text-[11px] gap-1"><Archive className="w-3 h-3" /> Archived</Badge>}
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              {project.key} · <span className="capitalize">{project.methodology}</span>
              {project.visibility === 'private' ? <><Lock className="w-3 h-3" /> Private</> : <><Globe className="w-3 h-3" /> Organization</>}
              {project.my_role === 'viewer' && ' · view only'}
              {activeSprint && <> · <Rocket className="w-3 h-3" /> {activeSprint.name}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setView('settings')} className="flex -space-x-1.5" title="Members">
            {members.slice(0, 6).map(m => <Avatar key={m.email} name={m.name} picture={m.picture} size="md" className="ring-2 ring-slate-50" />)}
            {members.length > 6 && <span className="w-8 h-8 rounded-full bg-slate-200 ring-2 ring-slate-50 text-xs flex items-center justify-center">+{members.length - 6}</span>}
          </button>
          {editable && <Button className="gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={() => setCreating({})} data-testid="new-task-btn"><Plus className="w-4 h-4" /> New task</Button>}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 -mx-3 px-3 sm:mx-0 sm:px-0">
        {VIEWS.filter(v => v.key !== 'sprints' || isScrum || sprints.length).map(v => {
          const Icon = v.icon;
          const on = v.key === view;
          return (
            <button key={v.key} type="button" onClick={() => setView(v.key)} data-testid={`view-${v.key}`}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${on ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <Icon className="w-4 h-4" />{v.label}
            </button>
          );
        })}
      </div>

      {/* Filters for task views */}
      {current.tasks && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Filter tasks" className="pl-8 h-9 bg-white" />
          </div>
          <div className="flex -space-x-1">
            {members.slice(0, 8).map(m => (
              <button key={m.email} type="button" onClick={() => setFilter('assignee', filters.assignee === m.email ? ALL : m.email)}
                className={`rounded-full transition-transform hover:-translate-y-0.5 ${filters.assignee === m.email ? 'ring-2 ring-slate-900 z-10' : 'ring-2 ring-slate-50'}`} title={m.name}>
                <Avatar name={m.name} picture={m.picture} size="md" />
              </button>
            ))}
          </div>
          <Select value={filters.assignee} onValueChange={(v) => setFilter('assignee', v)}>
            <SelectTrigger className="w-36 h-9 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>Anyone</SelectItem>
              <SelectItem value="__none">Unassigned</SelectItem>
              {members.map(m => <SelectItem key={m.email} value={m.email}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.priority} onValueChange={(v) => setFilter('priority', v)}>
            <SelectTrigger className="w-32 h-9 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any priority</SelectItem>
              {PRIORITY_ORDER.map(p => <SelectItem key={p} value={p}>{PRIORITIES[p].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.type} onValueChange={(v) => setFilter('type', v)}>
            <SelectTrigger className="w-28 h-9 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any type</SelectItem>
              {Object.entries(TASK_TYPES).map(([k, t]) => <SelectItem key={k} value={k}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {(project.labels || []).length > 0 && (
            <Select value={filters.label} onValueChange={(v) => setFilter('label', v)}>
              <SelectTrigger className="w-32 h-9 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any label</SelectItem>
                {project.labels.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {sprints.length > 0 && (
            <Select value={filters.sprint === ALL && sprintFilter !== ALL ? sprintFilter : filters.sprint} onValueChange={(v) => setFilter('sprint', v)}>
              <SelectTrigger className="w-52 h-9 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sprints</SelectItem>
                <SelectItem value="__backlog">Backlog only</SelectItem>
                {sprints.filter(s => s.status !== 'completed').map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (active)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-1.5 ml-1">
            <Checkbox id="hide-done" checked={filters.hideDone} onCheckedChange={(v) => setFilter('hideDone', !!v)} />
            <Label htmlFor="hide-done" className="text-xs text-slate-600">Hide done</Label>
          </div>
          {filterCount > 0 && <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setFilters(EMPTY_FILTERS)}><X className="w-3.5 h-3.5" /> Clear</Button>}
        </div>
      )}

      {/* Content */}
      {view === 'board' && <BoardView project={project} tasks={filtered} setTasks={setTasks} onOpen={setOpenTask} onCreate={(d) => setCreating({ ...d, ...(isScrum && activeSprint && sprintFilter === activeSprint.id ? { sprint_id: activeSprint.id } : {}) })} editable={editable} onChanged={refresh} />}
      {view === 'list' && <ListView project={project} tasks={filtered} people={people} onOpen={setOpenTask} onCreate={setCreating} editable={editable} onChanged={refresh} />}
      {view === 'calendar' && <CalendarView project={project} tasks={filtered} setTasks={setTasks} onOpen={setOpenTask} onCreate={setCreating} editable={editable} holidays={holidays} />}
      {view === 'timeline' && <TimelineView project={project} tasks={filtered} milestones={milestones} onOpen={setOpenTask} />}
      {view === 'sprints' && <SprintsTab project={project} tasks={tasks} sprints={sprints} editable={editable} onOpen={setOpenTask} onCreate={setCreating} onChanged={refresh} />}
      {view === 'milestones' && <MilestonesTab project={project} milestones={milestones} tasks={tasks} editable={editable} onOpen={setOpenTask} onChanged={refresh} />}
      {view === 'docs' && <DocsTab project={project} editable={editable} />}
      {view === 'reports' && <ReportsTab project={project} />}
      {view === 'activity' && <ActivityTab project={project} onOpen={setOpenTask} />}
      {view === 'settings' && <SettingsTab key={`${project.updated_at}`} project={project} people={people} onChanged={() => { loadProject(); loadTasks(); notifyProjectsChanged(); }} />}

      <TaskDrawer taskId={openTaskId} onClose={() => setOpenTask(null)} onChanged={refresh} onOpenTask={setOpenTask} />
      <NewTaskDialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} project={project} defaults={creating || {}} onCreated={refresh} />
    </div>
  );
}
