import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, AlertTriangle, CalendarClock, CheckCircle2, Plus, FolderKanban, Diamond, ArrowRight, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getAuth } from '@/lib/auth';
import { API, fmtDate, fromNow, notifyProjectsChanged } from '../lib';
import { useLoad, usePmMeta } from '../hooks';
import { PageHeader, StatCard, Loading, ErrorState, Empty, ProjectDot, PriorityIcon, StatusBadge, DueDate, Avatar } from '../components/Shared';
import NewTaskDialog from '../components/NewTaskDialog';
import ProjectFormDialog from '../components/ProjectFormDialog';
import TaskDrawer from '../components/TaskDrawer';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Xeno PM home: my work, project health, upcoming milestones and activity. */
export default function PmHomePage() {
  const navigate = useNavigate();
  const meta = usePmMeta();
  const { user } = getAuth();
  const { data, loading, error, reload } = useLoad(`${API}/overview`, 'Failed to load your workspace');
  const [newTask, setNewTask] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [openTask, setOpenTask] = useState(null);

  if (loading && !data) return <div className="p-6"><Loading /></div>;
  if (error) return <div className="p-6"><ErrorState message={error} onRetry={reload} /></div>;

  const { my, projects, milestones, activity } = data;
  const active = projects.filter(p => !['completed', 'cancelled'].includes(p.status));

  return (
    <div className="p-3 sm:p-4 md:p-8 w-full space-y-6">
      <PageHeader icon={LayoutDashboard} title={`${greeting()}, ${(user?.full_name || '').split(' ')[0] || 'there'}`} subtitle="Here's what's on your plate across all projects">
        {projects.length > 0 && <Button variant="outline" className="gap-1.5 bg-white" onClick={() => setNewTask(true)}><Plus className="w-4 h-4" /> New task</Button>}
        {meta?.can_create_projects && <Button className="gap-1.5" onClick={() => setNewProject(true)} data-testid="home-new-project"><FolderKanban className="w-4 h-4" /> New project</Button>}
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Open tasks" value={my.open} icon={CheckSquare} tone="sky" />
        <StatCard label="Overdue" value={my.overdue} icon={AlertTriangle} tone={my.overdue ? 'red' : 'slate'} />
        <StatCard label="Due today" value={my.due_today} icon={CalendarClock} tone="amber" />
        <StatCard label="Due in 7 days" value={my.due_this_week} icon={CalendarClock} tone="purple" />
        <StatCard label="Done this week" value={my.done_this_week} icon={CheckCircle2} tone="emerald" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-slate-100 shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-lg" style={{ fontFamily: 'Plus Jakarta Sans' }}>My tasks</CardTitle>
            <Link to="/pm/my-tasks" className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></Link>
          </CardHeader>
          <CardContent className="p-0">
            {my.tasks.length === 0 ? <Empty icon={CheckCircle2} title="Nothing assigned to you. Enjoy the calm!" /> : (
              <div className="divide-y divide-slate-100">
                {my.tasks.map(t => (
                  <button key={t.id} type="button" onClick={() => setOpenTask(t.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                    <PriorityIcon priority={t.priority} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900 truncate">{t.title}</p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><ProjectDot color={t.project.color} /> {t.key} · {t.project.name}</p>
                    </div>
                    <StatusBadge label={t.status_label} color={t.status_color} />
                    <span className="hidden sm:block w-24 text-right"><DueDate task={t} compact /></span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-100 shadow-sm">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-lg flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}><Diamond className="w-4 h-4 text-purple-600" /> Upcoming milestones</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            {milestones.length === 0 ? <p className="text-sm text-slate-500">No milestones in the next 45 days.</p> : (
              <ul className="space-y-2.5">
                {milestones.map(m => (
                  <li key={m.id}>
                    <Link to={`/pm/projects/${m.project_id}?view=milestones`} className="flex items-center gap-2 group">
                      <ProjectDot color={m.project?.color} />
                      <span className="text-sm text-slate-800 truncate flex-1 group-hover:underline">{m.name}</span>
                      <span className={`text-xs ${m.due_date < new Date().toISOString().slice(0, 10) ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{fmtDate(m.due_date, 'dd MMM')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>Projects</h2>
          <Link to="/pm/projects" className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">All projects <ArrowRight className="w-3 h-3" /></Link>
        </div>
        {active.length === 0 ? (
          <Card className="border-dashed"><Empty icon={FolderKanban} title="No projects yet">
            {meta?.can_create_projects ? <Button size="sm" className="mt-2" onClick={() => setNewProject(true)}>Create your first project</Button> : 'Ask your manager to add you to a project.'}
          </Empty></Card>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {active.slice(0, 9).map(p => {
              const pct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;
              return (
                <Link key={p.id} to={`/pm/projects/${p.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md hover:border-slate-300 transition-all">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: p.color }}>{p.key.slice(0, 2)}</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-500">{p.key} · {p.methodology}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{p.stats.done}/{p.stats.total} done</span>
                    {p.stats.overdue > 0 && <span className="text-red-600 font-medium">{p.stats.overdue} overdue</span>}
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-1.5 mt-1.5" />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-lg flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}><Activity className="w-4 h-4" /> Recent activity</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {activity.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
            <ol className="space-y-2.5">
              {activity.map(a => (
                <li key={a.id} className="flex items-start gap-2.5 text-sm">
                  <Avatar name={a.actor_name} size="sm" />
                  <p className="text-slate-600 min-w-0">
                    <span className="font-medium text-slate-900">{a.actor_name}</span> {a.action}{' '}
                    {a.task_key && (a.task_id
                      ? <button type="button" onClick={() => setOpenTask(a.task_id)} className="font-medium text-slate-800 hover:underline">{a.task_key}</button>
                      : <span className="font-medium text-slate-800">{a.task_key}</span>)}
                    {a.detail && <span className="text-slate-500"> — {a.detail}</span>}
                    <span className="block text-[11px] text-slate-400">{a.project?.name} · {fromNow(a.at)}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <NewTaskDialog open={newTask} onOpenChange={setNewTask} projects={projects.filter(p => ['admin', 'member'].includes(p.my_role) && !p.archived)} onCreated={() => reload({ quiet: true })} />
      <ProjectFormDialog open={newProject} onOpenChange={setNewProject} onCreated={(p) => { notifyProjectsChanged(); navigate(`/pm/projects/${p.id}`); }} />
      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => reload({ quiet: true })} onOpenTask={setOpenTask} />
    </div>
  );
}
