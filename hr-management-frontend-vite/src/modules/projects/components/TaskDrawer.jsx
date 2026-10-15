import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Trash2, Plus, X, Link2, MessageSquare, Timer, Activity, Pencil, Check, ListChecks, GitBranch, Ban, CloudOff, Cloud, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import Markdown from '@/modules/engagement/components/Markdown';
import { API, PRIORITIES, PRIORITY_ORDER, TASK_TYPES, errorText, fmtDate, fromNow, hours, parseDuration, statusMeta, canEdit, todayStr } from '../lib';
import { usePeople } from '../hooks';
import { Avatar, TypeIcon, StatusBadge, PersonSelect, Loading, ErrorState } from './Shared';

const NONE = '__none';

const Row = ({ label, children }) => (
  <div className="grid grid-cols-[96px_1fr] items-center gap-2 min-h-9">
    <span className="text-xs font-medium text-slate-500">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const showWarnings = (warnings) => (warnings || []).forEach(w => toast.warning(w, { duration: 7000 }));

/**
 * Side drawer with everything about one task: fields, description, checklist,
 * sub-tasks, dependencies, comments, time log (synced to HR timesheets) and activity.
 * onChanged() is called after any change so the parent view can refresh.
 */
export default function TaskDrawer({ taskId, onClose, onChanged, onOpenTask }) {
  const people = usePeople();
  const me = getAuth().user;
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [extras, setExtras] = useState({ sprints: [], milestones: [], tasks: [] });
  const [title, setTitle] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [newSub, setNewSub] = useState('');
  const [comment, setComment] = useState('');
  const [log, setLog] = useState({ duration: '', date: todayStr(), note: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    setError(null);
    try {
      const r = await api.get(`${API}/tasks/${taskId}`);
      setTask(r.data);
      setTitle(r.data.title);
      setDesc(r.data.description || '');
    } catch (err) {
      setError(errorText(err, 'Failed to load task'));
    }
  }, [taskId]);

  useEffect(() => {
    setTask(null);
    setEditingDesc(false);
    load();
  }, [load]);

  // Sprints, milestones and sibling tasks for the pickers
  const projectId = task?.project_id;
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    Promise.all([
      api.get(`${API}/projects/${projectId}/sprints`),
      api.get(`${API}/projects/${projectId}/milestones`),
      api.get(`${API}/projects/${projectId}/tasks`),
    ]).then(([s, m, t]) => {
      if (alive) setExtras({ sprints: s.data.filter(x => x.status !== 'completed'), milestones: m.data, tasks: t.data });
    }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const editable = canEdit(task?.my_role);
  const project = task?.project;

  const update = async (changes, { quiet = false } = {}) => {
    try {
      const r = await api.put(`${API}/tasks/${task.id}`, changes);
      showWarnings(r.data.warnings);
      await load();
      onChanged?.();
      if (!quiet) toast.success('Saved');
    } catch (err) {
      toast.error(errorText(err, 'Failed to save'));
      load();
    }
  };

  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== task.title) update({ title: v }, { quiet: true });
    else setTitle(task.title);
  };

  const saveDesc = async () => {
    await update({ description: desc }, { quiet: true });
    setEditingDesc(false);
  };

  // ----- checklist -----
  const checklist = task?.checklist || [];
  const saveChecklist = (next) => update({ checklist: next.map(({ id, text, done }) => ({ id, text, done })) }, { quiet: true });
  const addCheck = () => {
    const text = newCheck.trim();
    if (!text) return;
    setNewCheck('');
    saveChecklist([...checklist, { text, done: false }]);
  };

  // ----- sub-tasks -----
  const addSubtask = async () => {
    const text = newSub.trim();
    if (!text) return;
    try {
      await api.post(`${API}/projects/${task.project_id}/tasks`, { title: text, parent_id: task.id });
      setNewSub('');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'Failed to add sub-task'));
    }
  };

  // ----- comments -----
  const addComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.post(`${API}/tasks/${task.id}/comments`, { body });
      setComment('');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'Failed to comment'));
    } finally {
      setBusy(false);
    }
  };
  const deleteComment = async (id) => {
    try {
      await api.delete(`${API}/comments/${id}`);
      load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete comment'));
    }
  };

  // ----- time -----
  const logTime = async () => {
    const minutes = parseDuration(log.duration);
    if (!minutes || minutes > 1440) {
      toast.error('Enter time like 1h 30m, 45m or 2');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(`${API}/tasks/${task.id}/worklogs`, { minutes, date: log.date, note: log.note });
      if (r.data.timesheet?.synced) toast.success('Time logged and added to your HR timesheet');
      else toast.warning(`Time logged in PM, but not added to your timesheet: ${r.data.timesheet?.reason || 'unknown reason'}`, { duration: 8000 });
      setLog({ duration: '', date: todayStr(), note: '' });
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'Failed to log time'));
    } finally {
      setBusy(false);
    }
  };
  const deleteWorklog = async (id) => {
    try {
      const r = await api.delete(`${API}/worklogs/${id}`);
      if (r.data.timesheet?.reason) toast.warning(`Removed from PM; timesheet entry kept (${r.data.timesheet.reason})`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete time entry'));
    }
  };

  const toggleWatch = async () => {
    try {
      const r = await api.post(`${API}/tasks/${task.id}/watch`);
      setTask(t => ({ ...t, watching: r.data.watching }));
    } catch (err) {
      toast.error(errorText(err, 'Failed'));
    }
  };

  const remove = async () => {
    try {
      await api.delete(`${API}/tasks/${task.id}`);
      toast.success(`${task.key} deleted`);
      onChanged?.();
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete'));
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/pm/projects/${task.project_id}?task=${task.id}`;
    navigator.clipboard?.writeText(url).then(() => toast.success('Link copied')).catch(() => {});
  };

  const status = task ? statusMeta(project, task.status) : null;
  const doneChecks = checklist.filter(c => c.done).length;
  const loggedPct = task?.estimate_hours ? Math.min(100, Math.round(((task.logged_minutes || 0) / 60 / task.estimate_hours) * 100)) : null;
  const dependencyOptions = extras.tasks.filter(t => t.id !== task?.id && !(task?.blocked_by || []).includes(t.id));

  return (
    <Sheet open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 overflow-y-auto">
        <SheetTitle className="sr-only">{task ? `${task.key} ${task.title}` : 'Task'}</SheetTitle>
        {error ? <ErrorState message={error} onRetry={load} /> : !task ? <Loading /> : (
          <div className="flex flex-col min-h-full">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-slate-100 pr-12 sticky top-0 bg-white z-10">
              {task.parent && (
                <button type="button" onClick={() => onOpenTask?.(task.parent.id)} className="text-xs text-slate-500 hover:text-slate-900 truncate max-w-[30%]">
                  {task.parent.key} /
                </button>
              )}
              <TypeIcon type={task.type} />
              <span className="text-sm font-semibold text-slate-600">{task.key}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={copyLink} title="Copy link"><Copy className="w-4 h-4" /></Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 gap-1" onClick={toggleWatch} title={task.watching ? 'Stop watching' : 'Watch'}>
                  {task.watching ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span className="hidden sm:inline text-xs">{task.watching ? 'Watching' : 'Watch'}</span>
                </Button>
                {editable && (task.my_role === 'admin' || task.reporter_email === me?.email) && (
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(true)} title="Delete"><Trash2 className="w-4 h-4" /></Button>
                )}
              </div>
            </div>

            <div className="grid lg:grid-cols-[1fr_260px] gap-0 flex-1">
              {/* Main column */}
              <div className="p-4 sm:p-6 space-y-6 min-w-0 lg:border-r border-slate-100">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  disabled={!editable}
                  className="text-lg sm:text-xl font-semibold border-transparent hover:border-slate-200 focus:border-slate-300 px-2 -mx-2 h-auto py-1.5 disabled:opacity-100 disabled:cursor-default"
                  data-testid="task-title-input"
                />

                {/* Description */}
                <section>
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-sm font-semibold text-slate-800">Description</h3>
                    {editable && !editingDesc && <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditingDesc(true)}><Pencil className="w-3 h-3" /> Edit</Button>}
                  </div>
                  {editingDesc ? (
                    <div className="space-y-2">
                      <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={8} placeholder="Add details, acceptance criteria, links… (supports **bold**, *italic*, - lists, [links](https://…))" autoFocus />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveDesc}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setDesc(task.description || ''); setEditingDesc(false); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : task.description ? (
                    <div className="text-sm text-slate-700 rounded-lg bg-slate-50 p-3"><Markdown text={task.description} /></div>
                  ) : (
                    <button type="button" disabled={!editable} onClick={() => setEditingDesc(true)} className="w-full text-left text-sm text-slate-400 rounded-lg border border-dashed border-slate-200 p-3 hover:bg-slate-50 disabled:hover:bg-transparent">
                      {editable ? 'Add a description…' : 'No description'}
                    </button>
                  )}
                </section>

                {/* Checklist */}
                <section>
                  <div className="flex items-center gap-2 mb-1.5">
                    <ListChecks className="w-4 h-4 text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800">Checklist</h3>
                    {checklist.length > 0 && <span className="text-xs text-slate-500">{doneChecks}/{checklist.length}</span>}
                  </div>
                  {checklist.length > 0 && <Progress value={(doneChecks / checklist.length) * 100} className="h-1.5 mb-2" />}
                  <div className="space-y-1">
                    {checklist.map((c) => (
                      <div key={c.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
                        <Checkbox checked={c.done} disabled={!editable} onCheckedChange={(v) => saveChecklist(checklist.map(x => (x.id === c.id ? { ...x, done: !!v } : x)))} />
                        <span className={`text-sm flex-1 ${c.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{c.text}</span>
                        {editable && <button type="button" onClick={() => saveChecklist(checklist.filter(x => x.id !== c.id))} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                    ))}
                  </div>
                  {editable && (
                    <div className="flex gap-2 mt-1.5">
                      <Input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} placeholder="Add an item" className="h-8 text-sm" />
                      <Button size="sm" variant="outline" className="h-8" onClick={addCheck}><Plus className="w-4 h-4" /></Button>
                    </div>
                  )}
                </section>

                {/* Sub-tasks */}
                {!task.parent_id && (
                  <section>
                    <div className="flex items-center gap-2 mb-1.5">
                      <GitBranch className="w-4 h-4 text-slate-500" />
                      <h3 className="text-sm font-semibold text-slate-800">Sub-tasks</h3>
                      {task.subtasks.length > 0 && <span className="text-xs text-slate-500">{task.subtasks.filter(s => s.status_category === 'done').length}/{task.subtasks.length}</span>}
                    </div>
                    <div className="rounded-lg border border-slate-100 divide-y divide-slate-100">
                      {task.subtasks.map(s => {
                        const sm = statusMeta(project, s.status);
                        return (
                          <button key={s.id} type="button" onClick={() => onOpenTask?.(s.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                            <span className="text-xs font-medium text-slate-500 shrink-0">{s.key}</span>
                            <span className={`text-sm flex-1 truncate ${s.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>{s.title}</span>
                            <StatusBadge label={sm.label} color={sm.color} />
                            <Avatar name={s.assignee_name} size="xs" />
                          </button>
                        );
                      })}
                      {editable && (
                        <div className="flex gap-2 p-2">
                          <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSubtask()} placeholder="Add a sub-task" className="h-8 text-sm" />
                          <Button size="sm" variant="outline" className="h-8" onClick={addSubtask}><Plus className="w-4 h-4" /></Button>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Dependencies */}
                <section>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Link2 className="w-4 h-4 text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800">Dependencies</h3>
                  </div>
                  <div className="space-y-1.5">
                    {task.blocked_by_tasks.map(b => (
                      <div key={b.id} className="flex items-center gap-2 text-sm">
                        <Ban className={`w-3.5 h-3.5 ${b.status_category === 'done' ? 'text-slate-300' : 'text-red-500'}`} />
                        <span className="text-xs text-slate-500">Blocked by</span>
                        <button type="button" onClick={() => onOpenTask?.(b.id)} className={`truncate hover:underline ${b.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>{b.key} {b.title}</button>
                        {editable && <button type="button" onClick={() => update({ blocked_by: task.blocked_by.filter(id => id !== b.id) }, { quiet: true })} className="ml-auto text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                    ))}
                    {task.blocking_tasks.map(b => (
                      <div key={b.id} className="flex items-center gap-2 text-sm">
                        <Ban className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs text-slate-500">Blocks</span>
                        <button type="button" onClick={() => onOpenTask?.(b.id)} className="truncate hover:underline text-slate-800">{b.key} {b.title}</button>
                      </div>
                    ))}
                    {!task.blocked_by_tasks.length && !task.blocking_tasks.length && <p className="text-xs text-slate-400">No dependencies</p>}
                    {editable && dependencyOptions.length > 0 && (
                      <Select value="" onValueChange={(id) => update({ blocked_by: [...(task.blocked_by || []), id] }, { quiet: true })}>
                        <SelectTrigger className="h-8 text-xs w-full sm:w-72"><SelectValue placeholder="+ Add “blocked by” task" /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          {dependencyOptions.map(t => <SelectItem key={t.id} value={t.id}>{t.key} · {t.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </section>

                {/* Comments / time / activity */}
                <Tabs defaultValue="comments">
                  <TabsList className="bg-slate-100">
                    <TabsTrigger value="comments" className="gap-1.5 text-xs sm:text-sm"><MessageSquare className="w-3.5 h-3.5" /> Comments {task.comments.length > 0 && `(${task.comments.length})`}</TabsTrigger>
                    <TabsTrigger value="time" className="gap-1.5 text-xs sm:text-sm"><Timer className="w-3.5 h-3.5" /> Time</TabsTrigger>
                    <TabsTrigger value="activity" className="gap-1.5 text-xs sm:text-sm"><Activity className="w-3.5 h-3.5" /> Activity</TabsTrigger>
                  </TabsList>

                  <TabsContent value="comments" className="space-y-3 mt-3">
                    {task.comments.map(c => (
                      <div key={c.id} className="flex gap-2.5">
                        <Avatar name={c.author_name} size="md" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-800">{c.author_name}</span>
                            <span className="text-slate-400">{fromNow(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
                            {(c.author_email === me?.email || task.my_role === 'admin') && (
                              <button type="button" onClick={() => deleteComment(c.id)} className="ml-auto text-slate-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                            )}
                          </div>
                          <div className="text-sm text-slate-700 mt-0.5 rounded-lg bg-slate-50 px-3 py-2"><Markdown text={c.body} /></div>
                        </div>
                      </div>
                    ))}
                    <div className="space-y-2">
                      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Write a comment… mention someone with @their.email@company.com"
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment(); }} />
                      <div className="flex items-center justify-between gap-2">
                        <Select value="" onValueChange={(email) => setComment(c => `${c}${c && !c.endsWith(' ') ? ' ' : ''}@${email} `)}>
                          <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="@ Mention" /></SelectTrigger>
                          <SelectContent className="max-h-64">{people.map(p => <SelectItem key={p.email} value={p.email}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button size="sm" onClick={addComment} disabled={busy || !comment.trim()}>Comment</Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="time" className="space-y-3 mt-3">
                    {editable && (
                      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-[110px_150px_1fr] gap-2">
                          <Input value={log.duration} onChange={(e) => setLog(l => ({ ...l, duration: e.target.value }))} placeholder="1h 30m" className="h-9" />
                          <Input type="date" value={log.date} max={todayStr()} onChange={(e) => setLog(l => ({ ...l, date: e.target.value }))} className="h-9" />
                          <Input value={log.note} onChange={(e) => setLog(l => ({ ...l, note: e.target.value }))} placeholder="What did you work on?" className="h-9 col-span-2 sm:col-span-1" />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-500">Entries are added to your weekly HR timesheet as draft time.</p>
                          <Button size="sm" onClick={logTime} disabled={busy} className="shrink-0">Log time</Button>
                        </div>
                      </div>
                    )}
                    {task.worklogs.length === 0 ? <p className="text-xs text-slate-400">No time logged yet.</p> : (
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                        {task.worklogs.map(w => (
                          <div key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <Avatar name={w.user_name} size="xs" />
                            <span className="font-medium text-slate-800">{hours(w.minutes)}</span>
                            <span className="text-xs text-slate-500">{fmtDate(w.date, 'dd MMM')}</span>
                            <span className="text-xs text-slate-600 truncate flex-1">{w.note}</span>
                            <span title={w.timesheet_synced ? 'In HR timesheet' : 'Not in HR timesheet'}>
                              {w.timesheet_synced ? <Cloud className="w-3.5 h-3.5 text-emerald-500" /> : <CloudOff className="w-3.5 h-3.5 text-slate-300" />}
                            </span>
                            {(w.user_email === me?.email || task.my_role === 'admin') && (
                              <button type="button" onClick={() => deleteWorklog(w.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="activity" className="mt-3">
                    <ol className="space-y-2">
                      {task.activity.map(a => (
                        <li key={a.id} className="flex gap-2 text-xs">
                          <Avatar name={a.actor_name} size="xs" />
                          <p className="text-slate-600"><span className="font-medium text-slate-800">{a.actor_name}</span> {a.action}{a.detail ? <span className="text-slate-500"> — {a.detail}</span> : null} <span className="text-slate-400">· {fromNow(a.at)}</span></p>
                        </li>
                      ))}
                    </ol>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Field sidebar */}
              <aside className="p-4 sm:p-5 space-y-1 bg-slate-50/50 border-t lg:border-t-0 border-slate-100">
                <Row label="Status">
                  <Select value={task.status} onValueChange={(v) => update({ status: v }, { quiet: true })} disabled={!editable}>
                    <SelectTrigger className="h-8"><SelectValue><StatusBadge label={status.label} color={status.color} /></SelectValue></SelectTrigger>
                    <SelectContent>{project.statuses.map(s => <SelectItem key={s.key} value={s.key}><StatusBadge label={s.label} color={s.color} /></SelectItem>)}</SelectContent>
                  </Select>
                </Row>
                <Row label="Assignee">
                  <PersonSelect people={people} value={task.assignee_email} onChange={(v) => update({ assignee_email: v || null }, { quiet: true })} disabled={!editable} className="h-8" />
                </Row>
                <Row label="Priority">
                  <Select value={task.priority} onValueChange={(v) => update({ priority: v }, { quiet: true })} disabled={!editable}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITY_ORDER.map(p => { const P = PRIORITIES[p]; const I = P.icon; return <SelectItem key={p} value={p}><span className="flex items-center gap-2"><I className={`w-4 h-4 ${P.cls}`} />{P.label}</span></SelectItem>; })}</SelectContent>
                  </Select>
                </Row>
                <Row label="Type">
                  <Select value={task.type} onValueChange={(v) => update({ type: v }, { quiet: true })} disabled={!editable}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TASK_TYPES).map(([k, T]) => { const I = T.icon; return <SelectItem key={k} value={k}><span className="flex items-center gap-2"><I className={`w-4 h-4 ${T.cls}`} />{T.label}</span></SelectItem>; })}</SelectContent>
                  </Select>
                </Row>
                <Row label="Start date">
                  <Input type="date" className="h-8" value={task.start_date || ''} disabled={!editable} onChange={(e) => update({ start_date: e.target.value || null }, { quiet: true })} />
                </Row>
                <Row label="Due date">
                  <Input type="date" className="h-8" value={task.due_date || ''} disabled={!editable} onChange={(e) => update({ due_date: e.target.value || null }, { quiet: true })} />
                </Row>
                <Row label="Estimate (h)">
                  <Input type="number" min="0" step="0.5" className="h-8" defaultValue={task.estimate_hours ?? ''} key={`est-${task.estimate_hours}`} disabled={!editable}
                    onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== task.estimate_hours) update({ estimate_hours: v }, { quiet: true }); }} />
                </Row>
                <Row label="Story points">
                  <Input type="number" min="0" className="h-8" defaultValue={task.story_points ?? ''} key={`sp-${task.story_points}`} disabled={!editable}
                    onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== task.story_points) update({ story_points: v }, { quiet: true }); }} />
                </Row>
                <Row label="Sprint">
                  <Select value={task.sprint_id || NONE} onValueChange={(v) => update({ sprint_id: v === NONE ? null : v }, { quiet: true })} disabled={!editable}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Backlog" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Backlog</SelectItem>
                      {task.sprint && !extras.sprints.some(s => s.id === task.sprint.id) && <SelectItem value={task.sprint.id}>{task.sprint.name}</SelectItem>}
                      {extras.sprints.map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (active)' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="Milestone">
                  <Select value={task.milestone_id || NONE} onValueChange={(v) => update({ milestone_id: v === NONE ? null : v }, { quiet: true })} disabled={!editable}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {extras.milestones.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Row>
                <div className="pt-2">
                  <span className="text-xs font-medium text-slate-500">Labels</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {(project.labels || []).map(l => {
                      const on = (task.label_ids || []).includes(l.id);
                      return (
                        <button key={l.id} type="button" disabled={!editable}
                          onClick={() => update({ label_ids: on ? task.label_ids.filter(id => id !== l.id) : [...(task.label_ids || []), l.id] }, { quiet: true })}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium border transition-colors ${on ? '' : 'opacity-50 hover:opacity-100'}`}
                          style={{ backgroundColor: on ? `${l.color}22` : 'transparent', color: l.color, borderColor: `${l.color}55` }}>
                          {on && <Check className="w-3 h-3 inline mr-0.5" />}{l.name}
                        </button>
                      );
                    })}
                    {!(project.labels || []).length && <span className="text-xs text-slate-400">No labels defined</span>}
                  </div>
                </div>
                <div className="pt-4 space-y-1.5 text-xs text-slate-500">
                  <div className="flex justify-between"><span>Time logged</span><span className="font-medium text-slate-700">{hours(task.logged_minutes)}{task.estimate_hours ? ` / ${task.estimate_hours}h` : ''}</span></div>
                  {loggedPct != null && <Progress value={loggedPct} className="h-1.5" />}
                  <div className="flex justify-between pt-2"><span>Reporter</span><span className="text-slate-700 truncate ml-2">{task.reporter_name}</span></div>
                  <div className="flex justify-between"><span>Created</span><span>{fmtDate(task.created_at)}</span></div>
                  <div className="flex justify-between"><span>Updated</span><span>{fromNow(task.updated_at)}</span></div>
                  {task.completed_at && <div className="flex justify-between"><span>Completed</span><span>{fmtDate(task.completed_at)}</span></div>}
                </div>
              </aside>
            </div>
          </div>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {task?.key}?</AlertDialogTitle>
              <AlertDialogDescription>The task, its sub-tasks, comments and time entries will be permanently deleted. Draft timesheet entries are removed too.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
