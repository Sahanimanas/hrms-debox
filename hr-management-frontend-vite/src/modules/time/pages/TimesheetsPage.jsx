import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Trash2, Save, Send, Undo2, CheckCircle, XCircle, FolderKanban, Download, Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { fmtMinutes } from '@/lib/time';
import { exportCsv } from '@/lib/exportCsv';

const iso = (d) => format(d, 'yyyy-MM-dd');
const mondayOf = (d) => startOfWeek(d, { weekStartsOn: 1 });
const toHours = (minutes) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : '');
const toMinutes = (hours) => {
  const n = parseFloat(hours);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
};
// Why a typed hours value can't be saved, or null when it's fine (empty counts as 0)
const hoursError = (hours) => {
  if (hours === undefined || hours === null || hours === '') return null;
  if (/^\s*-/.test(hours)) return 'Hours cannot be negative';
  if (!/^\d*\.?\d*$/.test(hours) || !Number.isFinite(parseFloat(hours))) return 'Enter hours as a number, e.g. 7.5';
  if (parseFloat(hours) > 24) return 'A day has at most 24 hours';
  return null;
};

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

// The API stores a sent-back week as 'rejected'; people see "Sent back"
const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Sent back' };

const StatusBadge = ({ status }) => (
  <Badge className={`${STATUS_STYLE[status] || STATUS_STYLE.draft} hover:opacity-90`}>{STATUS_LABEL[status] || status}</Badge>
);

// ---------------------------------------------------------------- My week

const MyWeek = ({ projects }) => {
  const [searchParams] = useSearchParams();
  const initial = searchParams.get('week') ? parseISO(searchParams.get('week')) : new Date();
  const [weekStart, setWeekStart] = useState(iso(mondayOf(initial)));
  const [week, setWeek] = useState(null);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/timesheets/week', { params: { week_start: weekStart } });
      setWeek(res.data);
      setRows(res.data.rows.map(r => ({
        project_id: r.project_id,
        task: r.task,
        hours: Object.fromEntries(Object.entries(r.minutes).map(([d, m]) => [d, toHours(m)])),
      })));
      setDirty(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load timesheet');
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const editable = week && ['draft', 'rejected'].includes(week.status);
  const dates = week?.dates || [];

  const updateRow = (i, patch) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => {
    setRows([...rows, { project_id: projects[0]?.id || '', task: '', hours: {} }]);
    setDirty(true);
  };
  const removeRow = (i) => {
    setRows(rows.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const dayTotals = dates.map(d => rows.reduce((s, r) => s + toMinutes(r.hours[d]), 0));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  const save = async () => {
    if (rows.some(r => !r.project_id)) return toast.error('Pick a project for every row');
    const badCell = rows.flatMap(r => dates.map(d => [d, hoursError(r.hours[d])])).find(([, err]) => err);
    if (badCell) return toast.error(`${format(parseISO(badCell[0]), 'EEE dd MMM')}: ${badCell[1]}`);
    setBusy(true);
    try {
      const payload = {
        week_start: weekStart,
        rows: rows.map(r => ({
          project_id: r.project_id,
          task: r.task,
          minutes: Object.fromEntries(dates.map(d => [d, toMinutes(r.hours[d])]).filter(([, m]) => m > 0)),
        })),
      };
      await api.put('/timesheets/week', payload);
      toast.success('Timesheet saved');
      await load();
      return true;
    } catch (error) {
      toast.error(error.response?.data?.errors?.[0]?.message || error.response?.data?.detail || 'Failed to save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      await api.post('/timesheets/week/submit', { week_start: weekStart });
      toast.success('Submitted for approval');
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit');
    } finally {
      setBusy(false);
    }
  };

  const recall = async () => {
    try {
      await api.post('/timesheets/week/recall', { week_start: weekStart });
      toast.success('Timesheet recalled');
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to recall');
    }
  };

  const shiftWeek = (delta) => setWeekStart(iso(addDays(parseISO(weekStart), delta * 7)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></Button>
          <p className="font-semibold text-slate-900 text-sm sm:text-base">
            {format(parseISO(weekStart), 'dd MMM')} – {format(addDays(parseISO(weekStart), 6), 'dd MMM yyyy')}
          </p>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight className="w-4 h-4" /></Button>
          {week && <StatusBadge status={week.status} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <Button variant="outline" onClick={save} disabled={busy || !dirty} className="gap-1.5"><Save className="w-4 h-4" /> Save</Button>
              <Button onClick={submit} disabled={busy || weekTotal === 0} className="gap-1.5"><Send className="w-4 h-4" /> Submit</Button>
            </>
          )}
          {week?.status === 'submitted' && (
            <Button variant="outline" onClick={recall} className="gap-1.5"><Undo2 className="w-4 h-4" /> Recall</Button>
          )}
        </div>
      </div>

      {week?.status === 'rejected' && week.sheet?.comments && (
        <Card className="border-red-200 bg-red-50 shadow-none">
          <CardContent className="p-3 text-sm text-red-800">
            Sent back by {week.sheet.actioned_by_name}: “{week.sheet.comments}”
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-md">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-medium px-3 py-3 w-48">Project</th>
                <th className="text-left font-medium px-3 py-3">Task</th>
                {dates.map(d => (
                  <th key={d} className="font-medium px-1 py-3 text-center w-16">
                    {format(parseISO(d), 'EEE')}<br /><span className="normal-case text-[11px]">{format(parseISO(d), 'dd')}</span>
                  </th>
                ))}
                <th className="font-medium px-3 py-3 text-right w-24">Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => {
                const rowTotal = dates.reduce((s, d) => s + toMinutes(row.hours[d]), 0);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <Select value={row.project_id} onValueChange={(v) => updateRow(i, { project_id: v })} disabled={!editable}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Project" /></SelectTrigger>
                        <SelectContent>
                          {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input className="h-9" value={row.task} disabled={!editable} placeholder="What you worked on" onChange={(e) => updateRow(i, { task: e.target.value })} />
                    </td>
                    {dates.map(d => {
                      const err = hoursError(row.hours[d]);
                      return (
                        <td key={d} className="px-1 py-2">
                          <Input
                            className={`h-9 text-center px-1 ${err ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                            inputMode="decimal"
                            value={row.hours[d] || ''}
                            disabled={!editable}
                            aria-label={`Hours on ${d}`}
                            aria-invalid={!!err}
                            title={err || undefined}
                            // Keep a typed minus sign so it can be flagged instead of silently dropped
                            onChange={(e) => updateRow(i, { hours: { ...row.hours, [d]: e.target.value.replace(/[^0-9.-]/g, '') } })}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmtMinutes(rowTotal)}</td>
                    <td className="px-1 py-2">
                      {editable && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => removeRow(i)} aria-label="Remove row">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={dates.length + 4} className="text-center py-10 text-slate-500">No hours logged this week</td></tr>
              )}
            </tbody>
            <tfoot className="bg-slate-50 text-sm">
              <tr>
                <td className="px-3 py-2" colSpan={2}>
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={addRow} disabled={!projects.length} className="gap-1"><Plus className="w-4 h-4" /> Add row</Button>
                  )}
                  {!projects.length && <span className="text-xs text-slate-500">No projects yet — ask a manager to create one.</span>}
                </td>
                {dayTotals.map((m, i) => (
                  <td key={dates[i]} className={`px-1 py-2 text-center font-medium ${m > 1440 ? 'text-red-600' : 'text-slate-700'}`}>{m ? fmtMinutes(m) : '—'}</td>
                ))}
                <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{fmtMinutes(weekTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
      {rows.some(r => dates.some(d => hoursError(r.hours[d]))) && (
        <p className="text-xs text-red-600">Some cells are invalid (highlighted in red): {rows.flatMap(r => dates.map(d => hoursError(r.hours[d]))).find(Boolean)}</p>
      )}
      <p className="text-xs text-slate-500">Enter hours as decimals (7.5 = 7h 30m). Save as you go; submit at the end of the week.</p>
    </div>
  );
};

// ---------------------------------------------------------------- Approvals

const Approvals = () => {
  const { user } = getAuth();
  const [status, setStatus] = useState('submitted');
  const [sheets, setSheets] = useState([]);
  const [acting, setActing] = useState(null);
  const [comments, setComments] = useState('');

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let active = true;
    api.get('/timesheets/approvals', { params: { status } })
      .then((res) => {
        if (!active) return;
        setSheets(res.data || []);
      })
      .catch((error) => toast.error(error.response?.data?.detail || 'Failed to load approvals'));
    return () => { active = false; };
  }, [status, reloadKey]);

  const submitAction = async () => {
    try {
      await api.post(`/timesheets/sheets/${acting.sheet.id}/action`, { action: acting.action, comments });
      toast.success(acting.action === 'approve' ? 'Timesheet approved' : 'Timesheet sent back');
      setActing(null);
      setComments('');
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update timesheet');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="submitted">Awaiting approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Sent back</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card className="border-0 shadow-md">
        <CardContent className="p-0">
          {sheets.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-500">Nothing here</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sheets.map(s => (
                <div key={s.id} className="p-3 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{s.employee_name}</p>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-sm text-slate-700 mt-0.5">
                      Week of {format(parseISO(s.week_start), 'dd MMM yyyy')} · <b>{fmtMinutes(s.total_minutes)}</b>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.by_project.map(p => `${p.project} ${fmtMinutes(p.minutes)}`).join(' · ')}</p>
                  </div>
                  {s.status === 'submitted' && s.user_email === user?.email && (
                    <p className="text-xs text-slate-500 shrink-0">Your own timesheet: another approver must act on it</p>
                  )}
                  {s.status === 'submitted' && s.user_email !== user?.email && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={() => setActing({ sheet: s, action: 'reject' })}>
                        <XCircle className="w-4 h-4" /> Send back
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => setActing({ sheet: s, action: 'approve' })}>
                        <CheckCircle className="w-4 h-4" /> Approve
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!acting} onOpenChange={(open) => { if (!open) { setActing(null); setComments(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{acting?.action === 'approve' ? 'Approve timesheet' : 'Send timesheet back'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ts-comment">{acting?.action === 'approve' ? 'Comment (optional)' : 'What needs fixing?'}</Label>
            <Textarea id="ts-comment" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)}>Cancel</Button>
            <Button onClick={submitAction} disabled={acting?.action === 'reject' && !comments.trim()} className={acting?.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}>
              {acting?.action === 'approve' ? 'Approve' : 'Send back'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------- Projects

const EMPTY_PROJECT = { name: '', code: '', client: '', description: '', billable: true, members: '' };

const Projects = ({ onChange }) => {
  const [projects, setProjects] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_PROJECT);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let active = true;
    api.get('/timesheets/projects', { params: { include_archived: true } })
      .then((res) => {
        if (!active) return;
        setProjects(res.data || []);
      })
      .catch((error) => toast.error(error.response?.data?.detail || 'Failed to load projects'));
    return () => { active = false; };
  }, [reloadKey]);

  const open = (project) => {
    setDialog(project || 'new');
    setForm(project
      ? { name: project.name, code: project.code, client: project.client || '', description: project.description || '', billable: project.billable, members: (project.member_emails || []).join(', ') }
      : EMPTY_PROJECT);
  };

  const save = async () => {
    const members = form.members.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const body = { name: form.name, client: form.client, description: form.description, billable: form.billable, member_emails: members };
    try {
      if (dialog === 'new') await api.post('/timesheets/projects', { ...body, code: form.code });
      else await api.put(`/timesheets/projects/${dialog.id}`, body);
      toast.success('Project saved');
      setDialog(null);
      load();
      onChange?.();
    } catch (error) {
      toast.error(error.response?.data?.errors?.[0]?.message || error.response?.data?.detail || 'Failed to save project');
    }
  };

  const toggleArchive = async (p) => {
    try {
      await api.put(`/timesheets/projects/${p.id}`, { status: p.status === 'active' ? 'archived' : 'active' });
      load();
      onChange?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update project');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => open(null)} className="gap-1.5"><Plus className="w-4 h-4" /> New project</Button>
      </div>
      <Card className="border-0 shadow-md">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-medium px-4 py-3">Project</th>
                <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Client</th>
                <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Who can log</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <button type="button" className="text-left" onClick={() => open(p)}>
                      <p className="font-medium text-slate-900 hover:underline">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.code}{p.billable ? ' · billable' : ''}</p>
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 hidden sm:table-cell">{p.client || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell">{p.member_emails?.length ? `${p.member_emails.length} member(s)` : 'Everyone'}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="capitalize">{p.status}</Badge></td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => toggleArchive(p)}>
                      {p.status === 'active' ? <><Archive className="w-3.5 h-3.5" /> Archive</> : <><ArchiveRestore className="w-3.5 h-3.5" /> Restore</>}
                    </Button>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-500">No projects yet</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{dialog === 'new' ? 'New project' : 'Edit project'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="pj-name">Name</Label>
                <Input id="pj-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pj-code">Code</Label>
                <Input id="pj-code" value={form.code} disabled={dialog !== 'new'} placeholder="APL" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pj-client">Client</Label>
              <Input id="pj-client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pj-members">Restrict to (emails, optional)</Label>
              <Textarea id="pj-members" rows={2} value={form.members} placeholder="Leave empty so everyone can log time" onChange={(e) => setForm({ ...form, members: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <span className="text-sm font-medium text-slate-900">Billable by default</span>
              <Switch checked={form.billable} onCheckedChange={(v) => setForm({ ...form, billable: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim() || (dialog === 'new' && !form.code.trim())}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------- Report

const Breakdown = ({ title, rows, labelKey }) => (
  <Card className="border-0 shadow-md">
    <CardHeader className="p-4 border-b border-slate-100"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
    <CardContent className="p-0">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr key={r[labelKey]}>
              <td className="px-4 py-2.5 text-slate-900">{r[labelKey]}</td>
              <td className="px-4 py-2.5 text-right font-medium">{fmtMinutes(r.minutes)}</td>
              <td className="px-4 py-2.5 text-right text-xs text-slate-500">{fmtMinutes(r.billable_minutes)} billable</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="px-4 py-8 text-center text-slate-500">No hours in this range</td></tr>}
        </tbody>
      </table>
    </CardContent>
  </Card>
);

const Report = () => {
  const [from, setFrom] = useState(iso(addDays(mondayOf(new Date()), -28)));
  const [to, setTo] = useState(iso(new Date()));
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [report, setReport] = useState(null);

  useEffect(() => {
    let active = true;
    api.get('/timesheets/report', { params: { from, to, status: approvedOnly ? 'approved' : 'all' } })
      .then((res) => {
        if (!active) return;
        setReport(res.data);
      })
      .catch((error) => toast.error(error.response?.data?.detail || 'Failed to load report'));
    return () => { active = false; };
  }, [from, to, approvedOnly]);

  const download = () => exportCsv('timesheet-report', report.entries, [
    { key: 'date', label: 'Date' },
    { key: 'employee_name', label: 'Employee' },
    { key: 'department', label: 'Department' },
    { key: 'project_code', label: 'Project code' },
    { key: 'project_name', label: 'Project' },
    { key: 'task', label: 'Task' },
    { label: 'Hours', value: (e) => (e.minutes / 60).toFixed(2) },
    { label: 'Billable', value: (e) => (e.billable ? 'Yes' : 'No') },
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="rp-from">From</Label><Input id="rp-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rp-to">To</Label><Input id="rp-to" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:pb-2">
          <Switch checked={approvedOnly} onCheckedChange={setApprovedOnly} /> Approved weeks only
        </label>
        <div className="md:ml-auto">
          <Button variant="outline" onClick={download} disabled={!report?.entries?.length} className="gap-1.5"><Download className="w-4 h-4" /> Export CSV</Button>
        </div>
      </div>
      {report && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="border-slate-100 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500 uppercase tracking-wider">Total</p><p className="text-2xl font-bold text-slate-900">{fmtMinutes(report.total_minutes)}</p></CardContent></Card>
            <Card className="border-slate-100 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500 uppercase tracking-wider">Billable</p><p className="text-2xl font-bold text-slate-900">{fmtMinutes(report.billable_minutes)}</p></CardContent></Card>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Breakdown title="By project" rows={report.by_project} labelKey="project" />
            <Breakdown title="By person" rows={report.by_employee} labelKey="employee" />
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Page

const TimesheetsPage = () => {
  const { user } = getAuth();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const isApprover = user?.role === 'admin' || user?.role === 'manager';

  const [projectsReloadKey, setProjectsReloadKey] = useState(0);
  const loadProjects = useCallback(() => setProjectsReloadKey(k => k + 1), []);

  useEffect(() => {
    let active = true;
    api.get('/timesheets/projects')
      .then((res) => {
        if (!active) return;
        setProjects(res.data || []);
      })
      .catch((error) => toast.error(error.response?.data?.detail || 'Failed to load projects'));
    return () => { active = false; };
  }, [projectsReloadKey]);

  const defaultTab = useMemo(() => {
    const t = searchParams.get('tab');
    return ['approvals', 'projects', 'report'].includes(t) && (isApprover || t === 'report') ? t : 'week';
  }, [searchParams, isApprover]);

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
            <CalendarClock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>Timesheets</h1>
            <p className="text-xs sm:text-sm text-slate-600">Log hours against projects and get them approved weekly</p>
          </div>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="week">My timesheet</TabsTrigger>
            {isApprover && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
            {isApprover && <TabsTrigger value="projects" className="gap-1"><FolderKanban className="w-3.5 h-3.5" /> Projects</TabsTrigger>}
            <TabsTrigger value="report">Report</TabsTrigger>
          </TabsList>
          <TabsContent value="week" className="mt-4"><MyWeek projects={projects} /></TabsContent>
          {isApprover && <TabsContent value="approvals" className="mt-4"><Approvals /></TabsContent>}
          {isApprover && <TabsContent value="projects" className="mt-4"><Projects onChange={loadProjects} /></TabsContent>}
          <TabsContent value="report" className="mt-4"><Report /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default TimesheetsPage;
