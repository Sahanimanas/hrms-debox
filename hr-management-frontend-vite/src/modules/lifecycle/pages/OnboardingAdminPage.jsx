import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Plus, Download, Search, ListChecks, Trash2, Pencil, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate, OWNER_LABELS, todayYmd } from '../lib';
import { useEmployees } from '../hooks';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, ProgressBar, StatTile, NativeSelect, Avatar } from '../components/ui';
import ChecklistTasks from '../components/ChecklistTasks';
import LifecycleSettingsCard from '../components/LifecycleSettingsCard';

const OWNERS = ['hr', 'manager', 'employee', 'it'];
const EMPTY_TEMPLATE = { name: '', description: '', is_default: false, tasks: [{ title: '', owner: 'hr', due_offset_days: 0, description: '' }] };

const OnboardingAdminPage = () => {
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('in_progress');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [startOpen, setStartOpen] = useState(false);
  const [startForm, setStartForm] = useState({ employee_uid: '', template_id: '' });
  const [editing, setEditing] = useState(null);
  const [addTask, setAddTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const employees = useEmployees(isAdmin);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/onboarding`, { params: status === 'all' ? {} : { status } });
      setList(r.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load onboarding'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  const loadTemplates = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await api.get(`${API}/onboarding/templates`);
      setTemplates(r.data || []);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load templates'));
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const openChecklist = async (id) => {
    try {
      const r = await api.get(`${API}/onboarding/${id}`);
      setSelected(r.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to open checklist'));
    }
  };

  const updateTask = async (task, body) => {
    try {
      const r = await api.patch(`${API}/onboarding/${selected.id}/tasks/${task.id}`, body);
      setSelected({ ...r.data, access: selected.access });
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to update task'));
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(c => !q || c.employee_name?.toLowerCase().includes(q) || c.department?.toLowerCase().includes(q));
  }, [list, search]);

  const stats = useMemo(() => ({
    total: list.length,
    avg: list.length ? Math.round(list.reduce((s, c) => s + c.progress, 0) / list.length) : 0,
    overdue: list.filter(c => c.tasks.some(t => !t.done && t.due_date < todayYmd())).length,
  }), [list]);

  const startOnboarding = async () => {
    if (!startForm.employee_uid) return toast.error('Pick an employee');
    setBusy(true);
    try {
      await api.post(`${API}/onboarding/start`, { employee_uid: startForm.employee_uid, template_id: startForm.template_id || null });
      toast.success('Onboarding started — task owners notified');
      setStartOpen(false);
      setStartForm({ employee_uid: '', template_id: '' });
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to start onboarding'));
    } finally {
      setBusy(false);
    }
  };

  const cancelChecklist = async () => {
    if (!window.confirm('Cancel this onboarding checklist?')) return;
    try {
      await api.delete(`${API}/onboarding/${selected.id}`);
      toast.success('Checklist cancelled');
      setSelected(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to cancel'));
    }
  };

  const submitAddTask = async () => {
    if (!addTask.title.trim() || !addTask.due_date) return toast.error('Title and due date are required');
    try {
      const r = await api.post(`${API}/onboarding/${selected.id}/tasks`, { ...addTask, assignee_email: addTask.assignee_email || null });
      setSelected({ ...r.data, access: selected.access });
      setAddTask(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to add task'));
    }
  };

  const saveTemplate = async () => {
    const body = {
      name: editing.name,
      description: editing.description,
      is_default: editing.is_default,
      tasks: editing.tasks.map(t => ({ ...t, due_offset_days: Number(t.due_offset_days) || 0 })),
    };
    if (!body.name.trim()) return toast.error('Template name is required');
    if (body.tasks.some(t => !t.title.trim())) return toast.error('Every task needs a title');
    setBusy(true);
    try {
      if (editing.id) await api.put(`${API}/onboarding/templates/${editing.id}`, body);
      else await api.post(`${API}/onboarding/templates`, body);
      toast.success('Template saved');
      setEditing(null);
      loadTemplates();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to save template'));
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.delete(`${API}/onboarding/templates/${t.id}`);
      toast.success('Template deleted');
      loadTemplates();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to delete'));
    }
  };

  const setTaskField = (i, k, v) => setEditing({ ...editing, tasks: editing.tasks.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)) });

  const doExport = () => exportCsv('onboarding', filtered, [
    { key: 'employee_name', label: 'Employee' },
    { key: 'department', label: 'Department' },
    { label: 'Joining date', value: r => r.joining_date },
    { key: 'template_name', label: 'Template' },
    { key: 'status', label: 'Status' },
    { label: 'Tasks done', value: r => `${r.done_tasks}/${r.total_tasks}` },
    { key: 'progress', label: 'Progress %' },
  ]);

  const progressTab = (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="Checklists" value={stats.total} icon={ListChecks} />
        <StatTile label="Avg progress" value={`${stats.avg}%`} icon={ClipboardCheck} tone="emerald" />
        <StatTile label="With overdue tasks" value={stats.overdue} icon={X} tone="rose" />
      </div>
      <SectionCard
        icon={ListChecks}
        title="Onboarding progress"
        actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={doExport} disabled={!filtered.length}><Download className="w-3.5 h-3.5" />Export CSV</Button>}
      >
        <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search employee or department" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect value={status} onChange={setStatus} className="sm:w-44">
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </NativeSelect>
        </div>
        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : filtered.length === 0 ? (
          <Empty icon={ListChecks} title="No checklists" hint={isAdmin ? 'Checklists start automatically when you add an employee.' : 'Your team has no onboarding in this state.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Employee</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Joining</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Template</th>
                  <th className="text-left font-medium px-4 py-3 w-40">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openChecklist(c.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.employee_name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{c.employee_name}</p>
                          <p className="text-xs text-slate-500 truncate">{c.designation || '—'} · {c.department || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap hidden sm:table-cell">{fmtDate(c.joining_date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-600">{c.template_name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={c.progress} className="w-20 sm:w-24" />
                        <span className="text-xs font-medium text-slate-700 whitespace-nowrap">{c.done_tasks}/{c.total_tasks}</span>
                      </div>
                      {c.status !== 'in_progress' && <p className="text-[11px] text-slate-500 capitalize mt-0.5">{c.status}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const templatesTab = (
    <SectionCard
      icon={ClipboardCheck}
      title="Checklist templates"
      actions={<Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing({ ...EMPTY_TEMPLATE, tasks: [...EMPTY_TEMPLATE.tasks] })}><Plus className="w-3.5 h-3.5" />New template</Button>}
    >
      {templates.length === 0 ? <Loading /> : (
        <div className="divide-y divide-slate-100">
          {templates.map(t => (
            <div key={t.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-900">{t.name}</p>
                  {t.is_default && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 gap-1 text-[10px]"><Star className="w-3 h-3" />Default</Badge>}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{t.tasks.length} tasks · {OWNERS.map(o => `${t.tasks.filter(x => x.owner === o).length} ${OWNER_LABELS[o]}`).join(' · ')}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => setEditing({ ...t, tasks: t.tasks.map(x => ({ ...x })) })}><Pencil className="w-3.5 h-3.5" />Edit</Button>
                {!t.is_default && <Button variant="ghost" size="sm" className="h-8 text-red-600 hover:bg-red-50" onClick={() => deleteTemplate(t)} aria-label="Delete template"><Trash2 className="w-3.5 h-3.5" /></Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );

  return (
    <PageShell>
      <PageHeader icon={ClipboardCheck} title="Onboarding" subtitle={isAdmin ? 'Checklists for new joiners, templates and settings' : "Your team's onboarding progress"}>
        {isAdmin && (
          <Button onClick={() => setStartOpen(true)} className="gap-2 w-full sm:w-auto">
            <Plus className="w-4 h-4" />Start onboarding
          </Button>
        )}
      </PageHeader>

      {isAdmin ? (
        <Tabs defaultValue="progress">
          <TabsList>
            <TabsTrigger value="progress">Progress</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="progress">{progressTab}</TabsContent>
          <TabsContent value="templates">{templatesTab}</TabsContent>
          <TabsContent value="settings"><LifecycleSettingsCard /></TabsContent>
        </Tabs>
      ) : progressTab}

      {/* Checklist detail */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setAddTask(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {selected && (
            <>
              <DialogHeader className="p-4 sm:p-6 pb-2">
                <DialogTitle>{selected.employee_name}</DialogTitle>
                <p className="text-xs text-slate-500">{selected.template_name} · joining {fmtDate(selected.joining_date)} · {selected.done_tasks}/{selected.total_tasks} done</p>
                <ProgressBar value={selected.progress} className="mt-2" />
              </DialogHeader>
              <ChecklistTasks
                tasks={selected.tasks}
                canEdit={(t) => selected.status !== 'cancelled' && (selected.access === 'admin' || selected.access === 'manager' || t.assignee_email === user?.email)}
                onUpdate={updateTask}
              />
              {isAdmin && selected.status !== 'cancelled' && (
                <div className="p-4 sm:p-6 pt-3 border-t border-slate-100 space-y-3">
                  {addTask ? (
                    <div className="space-y-2">
                      <Input placeholder="Task title" value={addTask.title} onChange={(e) => setAddTask({ ...addTask, title: e.target.value })} />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <NativeSelect value={addTask.owner} onChange={(v) => setAddTask({ ...addTask, owner: v })}>
                          {OWNERS.map(o => <option key={o} value={o}>{OWNER_LABELS[o]}</option>)}
                        </NativeSelect>
                        <Input type="date" value={addTask.due_date} onChange={(e) => setAddTask({ ...addTask, due_date: e.target.value })} />
                        <NativeSelect value={addTask.assignee_email} onChange={(v) => setAddTask({ ...addTask, assignee_email: v })}>
                          <option value="">Auto-assign by owner</option>
                          {employees.map(e => <option key={e.email} value={e.email}>{e.full_name}</option>)}
                        </NativeSelect>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={submitAddTask}>Add task</Button>
                        <Button size="sm" variant="outline" onClick={() => setAddTask(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 justify-between">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddTask({ title: '', owner: 'hr', due_date: todayYmd(), assignee_email: '' })}><Plus className="w-3.5 h-3.5" />Add task</Button>
                      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={cancelChecklist}>Cancel checklist</Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Start onboarding */}
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Start onboarding</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <NativeSelect value={startForm.employee_uid} onChange={(v) => setStartForm({ ...startForm, employee_uid: v })}>
                <option value="">Select employee…</option>
                {employees.filter(e => e.employment_status !== 'exited').map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.id})</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Template</Label>
              <NativeSelect value={startForm.template_id} onChange={(v) => setStartForm({ ...startForm, template_id: v })}>
                <option value="">Default template</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </div>
            <p className="text-xs text-slate-500">Due dates are counted from the employee&apos;s joining date. Each task owner gets a notification.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOpen(false)}>Cancel</Button>
            <Button onClick={startOnboarding} disabled={busy}>{busy ? 'Starting…' : 'Start'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {editing && (
            <>
              <DialogHeader><DialogTitle>{editing.id ? 'Edit template' : 'New template'}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-name">Name</Label>
                    <Input id="tpl-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-2 sm:pt-6">
                    <Switch id="tpl-default" checked={!!editing.is_default} onCheckedChange={(v) => setEditing({ ...editing, is_default: v })} />
                    <Label htmlFor="tpl-default">Default for new joiners</Label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-desc">Description</Label>
                  <Textarea id="tpl-desc" rows={2} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Tasks</Label>
                  {editing.tasks.map((t, i) => (
                    <div key={t.id || i} className="border border-slate-200 rounded-lg p-2 sm:p-3 space-y-2">
                      <div className="flex gap-2">
                        <Input placeholder="Task title" value={t.title} onChange={(e) => setTaskField(i, 'title', e.target.value)} />
                        <Button variant="ghost" size="icon" className="shrink-0 text-red-600" aria-label="Remove task" disabled={editing.tasks.length === 1}
                          onClick={() => setEditing({ ...editing, tasks: editing.tasks.filter((_, idx) => idx !== i) })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <NativeSelect value={t.owner} onChange={(v) => setTaskField(i, 'owner', v)}>
                          {OWNERS.map(o => <option key={o} value={o}>Owner: {OWNER_LABELS[o]}</option>)}
                        </NativeSelect>
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={-60} max={365} value={t.due_offset_days} onChange={(e) => setTaskField(i, 'due_offset_days', e.target.value)} />
                          <span className="text-xs text-slate-500 whitespace-nowrap">days from joining</span>
                        </div>
                      </div>
                      <Input placeholder="Description (optional)" value={t.description || ''} onChange={(e) => setTaskField(i, 'description', e.target.value)} />
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing({ ...editing, tasks: [...editing.tasks, { title: '', owner: 'hr', due_offset_days: 0, description: '' }] })}>
                    <Plus className="w-3.5 h-3.5" />Add task
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={saveTemplate} disabled={busy}>{busy ? 'Saving…' : 'Save template'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default OnboardingAdminPage;
