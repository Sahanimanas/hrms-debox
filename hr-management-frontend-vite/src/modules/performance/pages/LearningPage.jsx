import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GraduationCap, BookOpen, Plus, Pencil, Archive, UserPlus, Upload, ExternalLink, AlertTriangle, CheckCircle2, Clock, ListTodo } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PF, useApi, apiError, currentUser, isLead, fmtDate, todayStr, LEARNING_STATUS } from '../lib';
import { PageShell, SectionCard, DataState, Pill, ExportButton, StatTile, PeoplePicker, SimpleSelect, DataTable } from '../components/common';

const STATUS_OPTIONS = Object.entries(LEARNING_STATUS).map(([value, s]) => ({ value, label: s.label }));

const assignmentCsv = (rows, name) => exportCsv(name, rows, [
  { key: 'employee_name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'course_title', label: 'Course' },
  { label: 'Mandatory', value: r => (r.mandatory ? 'yes' : 'no') }, { key: 'due_date', label: 'Due' }, { key: 'status', label: 'Status' },
  { label: 'Overdue', value: r => (r.overdue ? 'yes' : 'no') }, { label: 'Completed', value: r => fmtDate(r.completed_at) },
  { label: 'Certificate', value: r => r.certificate?.url || '' }, { key: 'assigned_by_name', label: 'Assigned by' },
]);

function DueCell({ a }) {
  if (!a.due_date) return <span className="text-slate-400">—</span>;
  return (
    <span className={`whitespace-nowrap ${a.overdue ? 'text-rose-600 font-medium' : a.due_soon ? 'text-amber-700' : ''}`}>
      {fmtDate(a.due_date)}{a.overdue ? ' · overdue' : ''}
    </span>
  );
}

function CourseForm({ course, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: course?.title || '', description: course?.description || '', provider: course?.provider || '', link: course?.link || '',
    duration_hours: course?.duration_hours ?? 1, category: course?.category || '', mandatory: !!course?.mandatory, active: course?.active !== false,
  }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (form.title.trim().length < 2) return toast.error('Course title is required');
    setSaving(true);
    try {
      const body = { ...form, title: form.title.trim(), duration_hours: Number(form.duration_hours) || 0, link: form.link.trim() || null };
      if (course) await api.put(`${PF}/courses/${course.id}`, body);
      else await api.post(`${PF}/courses`, body);
      toast.success('Course saved');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save course'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>{course ? 'Edit course' : 'New course'}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="co-title">Title</Label><Input id="co-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="co-desc">Description</Label><Textarea id="co-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="co-prov">Provider</Label><Input id="co-prov" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="co-cat">Category</Label><Input id="co-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Compliance, Technical…" /></div>
          <div className="space-y-1.5"><Label htmlFor="co-hrs">Duration (hours)</Label><Input id="co-hrs" type="number" min="0" step="0.5" value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="co-link">Link</Label><Input id="co-link" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.mandatory} onCheckedChange={(v) => setForm({ ...form, mandatory: v })} /> Mandatory</label>
        {course && <label className="flex items-center gap-2 text-sm"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /> Active in catalog</label>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">Save</Button>
      </DialogFooter>
    </>
  );
}

function AssignForm({ course, isAdmin, onClose, onSaved }) {
  const people = useApi(`${PF}/people`, { scope: isAdmin ? 'all' : 'team' });
  const [emails, setEmails] = useState([]);
  const [deps, setDeps] = useState([]);
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!emails.length && !deps.length) return toast.error('Choose people or departments');
    setSaving(true);
    try {
      const r = await api.post(`${PF}/courses/${course.id}/assign`, { employee_emails: emails, departments: deps, due_date: due || null });
      toast.success(`Assigned to ${r.data.assigned} people${r.data.skipped_existing ? ` (${r.data.skipped_existing} already had it)` : ''}`);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to assign'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>Assign &quot;{course.title}&quot;</DialogTitle></DialogHeader>
      <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
        <div className="space-y-1.5"><Label htmlFor="as-due">Due date</Label><Input id="as-due" type="date" min={todayStr()} value={due} onChange={(e) => setDue(e.target.value)} /></div>
        {isAdmin && (people.data?.departments || []).length > 0 && (
          <div className="space-y-1.5">
            <Label>Whole departments</Label>
            <div className="flex flex-wrap gap-3">
              {people.data.departments.map(d => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={deps.includes(d)} onCheckedChange={(v) => setDeps(v ? [...deps, d] : deps.filter(x => x !== d))} /> {d}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1.5"><Label>People</Label><PeoplePicker people={people.data?.people || []} selected={emails} onChange={setEmails} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">Assign</Button>
      </DialogFooter>
    </>
  );
}

function MyLearning({ state, summary, onChanged }) {
  const fileRef = useRef(null);
  const [uploadFor, setUploadFor] = useState(null);
  const rows = state.data || [];
  const setStatus = async (a, status) => {
    try {
      await api.put(`${PF}/learning/assignments/${a.id}/progress`, { status });
      toast.success('Progress updated');
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Failed to update'));
    }
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadFor) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`${PF}/learning/assignments/${uploadFor.id}/certificate`, fd);
      toast.success('Certificate uploaded — course marked complete');
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Upload failed'));
    } finally {
      setUploadFor(null);
    }
  };
  const leave = async (a) => {
    if (!window.confirm(`Leave "${a.course_title}"?`)) return;
    try {
      await api.delete(`${PF}/learning/assignments/${a.id}`);
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Failed to leave course'));
    }
  };
  return (
    <div className="space-y-4">
      {summary.data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <StatTile label="Assigned" value={summary.data.total} icon={ListTodo} />
          <StatTile label="Completed" value={summary.data.completed} icon={CheckCircle2} tone="emerald" />
          <StatTile label="Due this week" value={summary.data.due_soon} icon={Clock} tone="amber" />
          <StatTile label="Overdue" value={summary.data.overdue} icon={AlertTriangle} tone="rose" />
        </div>
      )}
      <SectionCard icon={GraduationCap} title="My learning" actions={<ExportButton disabled={!rows.length} onClick={() => assignmentCsv(rows, 'my-learning')} />}>
        <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
        <DataState state={state} empty={!rows.length} emptyText="Nothing assigned yet — browse the catalog to enroll" emptyIcon={GraduationCap}>
          <DataTable
            rows={rows}
            columns={[
              { key: 'course_title', label: 'Course', render: a => (
                <div>
                  <p className="font-medium text-slate-900">{a.course_title}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {a.mandatory && <Pill tone="rose">Mandatory</Pill>}
                    {a.self_enrolled && <Pill tone="blue">Self-enrolled</Pill>}
                  </div>
                </div>
              ) },
              { key: 'due', label: 'Due', render: a => <DueCell a={a} /> },
              { key: 'status', label: 'Status', render: a => (
                <SimpleSelect className="w-36" value={a.status} onChange={(v) => setStatus(a, v)} options={STATUS_OPTIONS} />
              ) },
              { key: 'cert', label: 'Certificate', hideOnMobile: true, render: a => (a.certificate
                ? <a href={a.certificate.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">{a.certificate.name}</a>
                : <span className="text-slate-400 text-xs">—</span>) },
              { key: 'actions', label: '', className: 'text-right', render: a => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setUploadFor(a); fileRef.current?.click(); }} title="Upload completion certificate"><Upload className="w-3.5 h-3.5" /></Button>
                  {a.self_enrolled && a.status !== 'completed' && <Button size="sm" variant="ghost" onClick={() => leave(a)} title="Leave course"><Archive className="w-3.5 h-3.5" /></Button>}
                </div>
              ) },
            ]}
          />
        </DataState>
      </SectionCard>
    </div>
  );
}

function Catalog({ isAdmin, lead, onChanged }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const courses = useApi(`${PF}/courses`, includeInactive ? { include_inactive: 'true' } : {});
  const [dialog, setDialog] = useState(null);
  const [q, setQ] = useState('');
  const rows = (courses.data || []).filter(c => !q || `${c.title} ${c.category} ${c.provider}`.toLowerCase().includes(q.toLowerCase()));
  const enroll = async (c) => {
    try {
      await api.post(`${PF}/courses/${c.id}/enroll`);
      toast.success('Enrolled');
      courses.reload();
      onChanged();
    } catch (error) {
      toast.error(apiError(error, 'Failed to enroll'));
    }
  };
  const archive = async (c) => {
    if (!window.confirm(`Remove "${c.title}" from the catalog?`)) return;
    try {
      const r = await api.delete(`${PF}/courses/${c.id}`);
      toast.success(r.data.message);
      courses.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to remove'));
    }
  };
  return (
    <SectionCard
      icon={BookOpen}
      title="Course catalog"
      actions={(
        <>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-36 sm:w-48" />
          {isAdmin && <label className="flex items-center gap-1.5 text-xs text-slate-600"><Checkbox checked={includeInactive} onCheckedChange={(v) => setIncludeInactive(!!v)} /> Archived</label>}
          <ExportButton disabled={!rows.length} onClick={() => exportCsv('courses', rows, [
            { key: 'title', label: 'Title' }, { key: 'provider', label: 'Provider' }, { key: 'category', label: 'Category' }, { key: 'duration_hours', label: 'Hours' },
            { label: 'Mandatory', value: r => (r.mandatory ? 'yes' : 'no') }, { key: 'link', label: 'Link' }, { key: 'assigned_count', label: 'Assigned' }, { key: 'completed_count', label: 'Completed' },
          ])} />
          {isAdmin && <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={() => setDialog({ kind: 'course' })}><Plus className="w-4 h-4 mr-1" /> New course</Button>}
        </>
      )}
      bodyClassName="p-3 sm:p-5"
    >
      <DataState state={courses} empty={!rows.length} emptyText="No courses in the catalog" emptyIcon={BookOpen}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(c => (
            <Card key={c.id} className={`border-slate-200 shadow-sm ${c.active === false ? 'opacity-60' : ''}`}>
              <CardContent className="p-4 space-y-2 h-full flex flex-col">
                <div className="flex flex-wrap gap-1">
                  {c.category && <Pill tone="purple">{c.category}</Pill>}
                  {c.mandatory && <Pill tone="rose">Mandatory</Pill>}
                  {c.active === false && <Pill>Archived</Pill>}
                </div>
                <p className="font-semibold text-slate-900">{c.title}</p>
                <p className="text-xs text-slate-500">{[c.provider, c.duration_hours ? `${c.duration_hours} h` : null].filter(Boolean).join(' · ')}</p>
                {c.description && <p className="text-sm text-slate-600 line-clamp-3">{c.description}</p>}
                {isAdmin && <p className="text-xs text-slate-500">{c.completed_count}/{c.assigned_count} completed</p>}
                <div className="flex flex-wrap gap-1.5 pt-1 mt-auto">
                  {c.link && <a href={c.link} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink className="w-3.5 h-3.5 mr-1" /> Open</Button></a>}
                  {c.my_assignment ? <Pill map={LEARNING_STATUS} value={c.my_assignment.status} className="self-center" />
                    : c.active !== false && <Button size="sm" variant="outline" onClick={() => enroll(c)}>Enroll</Button>}
                  {lead && c.active !== false && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'assign', course: c })}><UserPlus className="w-3.5 h-3.5 mr-1" /> Assign</Button>}
                  {isAdmin && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'course', course: c })}><Pencil className="w-3.5 h-3.5" /></Button>}
                  {isAdmin && c.active !== false && <Button size="sm" variant="ghost" onClick={() => archive(c)}><Archive className="w-3.5 h-3.5" /></Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DataState>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          {dialog?.kind === 'course' && <CourseForm course={dialog.course} onClose={() => setDialog(null)} onSaved={courses.reload} />}
          {dialog?.kind === 'assign' && <AssignForm course={dialog.course} isAdmin={isAdmin} onClose={() => setDialog(null)} onSaved={() => { courses.reload(); onChanged(); }} />}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function Assignments({ isAdmin, reloadKey }) {
  const [filter, setFilter] = useState('all');
  const params = { scope: isAdmin ? 'all' : 'team', ...(filter === 'overdue' ? { overdue: 'true' } : filter !== 'all' ? { status: filter } : {}), _r: reloadKey };
  const list = useApi(`${PF}/learning/assignments`, params);
  const summary = useApi(`${PF}/learning/summary`, { scope: isAdmin ? 'all' : 'team', _r: reloadKey });
  const rows = list.data || [];
  const remove = async (a) => {
    if (!window.confirm(`Remove ${a.employee_name}'s assignment?`)) return;
    try {
      await api.delete(`${PF}/learning/assignments/${a.id}`);
      list.reload();
      summary.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to remove'));
    }
  };
  return (
    <div className="space-y-4">
      {summary.data && summary.data.by_course.length > 0 && (
        <SectionCard icon={BookOpen} title="Completion by course">
          <DataTable
            rowKey="course_id"
            rows={summary.data.by_course}
            columns={[
              { key: 'course_title', label: 'Course', render: c => <span className="font-medium">{c.course_title}{c.mandatory ? ' *' : ''}</span> },
              { key: 'assigned', label: 'Assigned' },
              { key: 'completed', label: 'Completed', render: c => `${c.completed} (${Math.round((c.completed / (c.assigned || 1)) * 100)}%)` },
              { key: 'in_progress', label: 'In progress', hideOnMobile: true },
              { key: 'overdue', label: 'Overdue', render: c => <span className={c.overdue ? 'text-rose-600 font-medium' : ''}>{c.overdue}</span> },
            ]}
          />
        </SectionCard>
      )}
      <SectionCard
        icon={ListTodo}
        title={isAdmin ? 'All assignments' : 'Team assignments'}
        actions={(
          <>
            <SimpleSelect className="h-8 w-36" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'overdue', label: 'Overdue' }, ...STATUS_OPTIONS]} />
            <ExportButton disabled={!rows.length} onClick={() => assignmentCsv(rows, 'learning-assignments')} />
          </>
        )}
      >
        <DataState state={list} empty={!rows.length} emptyText="No assignments match" emptyIcon={ListTodo}>
          <DataTable
            rows={rows}
            columns={[
              { key: 'employee_name', label: 'Employee', render: a => <div><p className="font-medium text-slate-900">{a.employee_name}</p><p className="text-xs text-slate-500">{a.department}</p></div> },
              { key: 'course_title', label: 'Course', render: a => <span>{a.course_title}{a.mandatory ? ' *' : ''}</span> },
              { key: 'due', label: 'Due', hideOnMobile: true, render: a => <DueCell a={a} /> },
              { key: 'status', label: 'Status', render: a => <Pill map={LEARNING_STATUS} value={a.status} /> },
              { key: 'cert', label: 'Certificate', hideOnMobile: true, render: a => (a.certificate ? <a href={a.certificate.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">View</a> : '—') },
              { key: 'x', label: '', render: a => (isAdmin || a.assigned_by === currentUser().email) && <Button size="sm" variant="ghost" onClick={() => remove(a)}><Archive className="w-3.5 h-3.5" /></Button> },
            ]}
          />
        </DataState>
      </SectionCard>
    </div>
  );
}

const LearningPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'my';
  const setTab = (t) => setParams(p => { p.set('tab', t); return p; }, { replace: true });
  const [reloadKey, setReloadKey] = useState(0);
  const mine = useApi(`${PF}/learning/assignments`, { scope: 'my', _r: reloadKey });
  const summary = useApi(`${PF}/learning/summary`, { scope: 'my', _r: reloadKey });
  const bump = () => setReloadKey(k => k + 1);

  return (
    <PageShell icon={GraduationCap} title="Learning" subtitle="Courses, mandatory training and your progress">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="my">My learning</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          {lead && <TabsTrigger value="assignments">Assignments</TabsTrigger>}
        </TabsList>
        <TabsContent value="my"><MyLearning state={mine} summary={summary} onChanged={bump} /></TabsContent>
        <TabsContent value="catalog"><Catalog isAdmin={isAdmin} lead={lead} onChanged={bump} /></TabsContent>
        {lead && <TabsContent value="assignments"><Assignments isAdmin={isAdmin} reloadKey={reloadKey} /></TabsContent>}
      </Tabs>
    </PageShell>
  );
};

export default LearningPage;
