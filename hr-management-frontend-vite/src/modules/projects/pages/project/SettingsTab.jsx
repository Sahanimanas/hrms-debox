import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Trash2, ArrowUp, ArrowDown, Plus, X, Archive, RotateCcw, UserPlus, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { API, COLORS, PROJECT_STATUS, PROJECT_ROLES, errorText, notifyProjectsChanged } from '../../lib';
import { Avatar, PersonSelect, StatusBadge } from '../../components/Shared';

const CATEGORIES = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

function Section({ title, subtitle, children }) {
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base" style={{ fontFamily: 'Plus Jakarta Sans' }}>{title}</CardTitle>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

/** Project details, members & roles, workflow, labels and the danger zone. */
export default function SettingsTab({ project, people, onChanged }) {
  const navigate = useNavigate();
  const me = getAuth().user;
  const isAdmin = project.my_role === 'admin';
  // Initialised from props; ProjectPage remounts this tab (key) whenever the project is saved
  const [details, setDetails] = useState(() => ({
    name: project.name, description: project.description || '', color: project.color, status: project.status,
    visibility: project.visibility, methodology: project.methodology, lead_email: project.lead_email,
    start_date: project.start_date || '', due_date: project.due_date || '', client: project.client || '',
    budget_hours: project.budget_hours ?? '', billable: project.billable !== false,
  }));
  const [statuses, setStatuses] = useState(() => project.statuses.map(s => ({ ...s })));
  const [labels, setLabels] = useState(() => (project.labels || []).map(l => ({ ...l })));
  const [newMember, setNewMember] = useState({ email: '', role: 'member' });
  const [confirm, setConfirm] = useState(null); // 'delete' | 'archive'

  const set = (k, v) => setDetails(d => ({ ...d, [k]: v }));

  const call = async (fn, success) => {
    try {
      await fn();
      if (success) toast.success(success);
      onChanged();
      return true;
    } catch (err) {
      toast.error(errorText(err, 'Failed to save'));
      return false;
    }
  };

  const saveDetails = () => call(() => api.put(`${API}/projects/${project.id}`, {
    ...details,
    start_date: details.start_date || null,
    due_date: details.due_date || null,
    budget_hours: details.budget_hours === '' ? null : Number(details.budget_hours),
  }), 'Project updated');

  const addMember = async () => {
    if (!newMember.email) return;
    if (await call(() => api.post(`${API}/projects/${project.id}/members`, newMember), 'Member added')) setNewMember({ email: '', role: 'member' });
  };

  const moveStatus = (i, dir) => setStatuses(list => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return list;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const archive = () => call(() => api.put(`${API}/projects/${project.id}`, { archived: !project.archived }), project.archived ? 'Project restored' : 'Project archived');
  const remove = async () => {
    try {
      await api.delete(`${API}/projects/${project.id}`);
      toast.success('Project deleted');
      notifyProjectsChanged();
      navigate('/pm/projects');
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete'));
    }
  };
  const leave = async () => {
    try {
      await api.delete(`${API}/projects/${project.id}/members/${encodeURIComponent(me.email)}`);
      notifyProjectsChanged();
      navigate('/pm/projects');
    } catch (err) {
      toast.error(errorText(err, 'Failed to leave project'));
    }
  };

  const memberEmails = new Set((project.members || []).map(m => m.email));
  const canDelete = me?.role === 'admin' || project.created_by === me?.email;

  return (
    <div className="space-y-5 max-w-4xl">
      <Section title="Details" subtitle={isAdmin ? 'Name, schedule, budget and visibility' : 'Only project admins can change settings'}>
        <fieldset disabled={!isAdmin} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Name</Label><Input className="mt-1" value={details.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><Label>Key</Label><Input className="mt-1" value={project.key} disabled /></div>
          </div>
          <div><Label>Description</Label><Textarea className="mt-1" rows={3} value={details.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={details.status} onValueChange={(v) => set('status', v)} disabled={!isAdmin}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PROJECT_STATUS).map(([k, s]) => <SelectItem key={k} value={k}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visibility</Label>
              <Select value={details.visibility} onValueChange={(v) => set('visibility', v)} disabled={!isAdmin}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="organization">Organization</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Methodology</Label>
              <Select value={details.methodology} onValueChange={(v) => set('methodology', v)} disabled={!isAdmin}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="kanban">Kanban</SelectItem><SelectItem value="scrum">Scrum (sprints)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-1">
              <Label>Lead</Label>
              <PersonSelect people={people} value={details.lead_email} onChange={(v) => set('lead_email', v)} allowNone={false} disabled={!isAdmin} className="mt-1" />
            </div>
            <div><Label>Start</Label><Input type="date" className="mt-1" value={details.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
            <div><Label>Target end</Label><Input type="date" className="mt-1" value={details.due_date} onChange={(e) => set('due_date', e.target.value)} /></div>
            <div><Label>Client</Label><Input className="mt-1" value={details.client} onChange={(e) => set('client', e.target.value)} /></div>
            <div><Label>Budget (hours)</Label><Input type="number" min="0" className="mt-1" value={details.budget_hours} onChange={(e) => set('budget_hours', e.target.value)} /></div>
            <div className="flex items-end gap-2 pb-2"><Switch checked={details.billable} onCheckedChange={(v) => set('billable', v)} disabled={!isAdmin} /><Label>Billable by default</Label></div>
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {COLORS.map(c => <button key={c} type="button" onClick={() => set('color', c)} aria-label={c} className={`w-7 h-7 rounded-lg ${details.color === c ? 'ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ backgroundColor: c }} />)}
            </div>
          </div>
          {isAdmin && <Button onClick={saveDetails} className="gap-1.5 bg-slate-800 hover:bg-slate-900"><Save className="w-4 h-4" /> Save details</Button>}
        </fieldset>
      </Section>

      <Section title="Members" subtitle="People come from the HR employee directory. Exited employees drop off automatically.">
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {(project.members || []).map(m => (
            <div key={m.email} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Avatar name={m.name} picture={m.picture} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 truncate">{m.name}{m.email === project.lead_email && <span className="ml-1.5 text-[10px] font-semibold uppercase bg-yellow-100 text-yellow-800 rounded px-1.5">Lead</span>}{m.active === false && <span className="ml-1.5 text-[10px] text-red-600">inactive</span>}</p>
                <p className="text-xs text-slate-500 truncate">{[m.designation, m.department, m.email].filter(Boolean).join(' · ')}</p>
              </div>
              {isAdmin ? (
                <>
                  <Select value={m.role} onValueChange={(role) => call(() => api.put(`${API}/projects/${project.id}/members/${encodeURIComponent(m.email)}`, { role }), 'Role updated')} disabled={m.email === project.lead_email}>
                    <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PROJECT_ROLES).map(([k, r]) => <SelectItem key={k} value={k}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {m.email !== project.lead_email && <Button size="sm" variant="ghost" className="h-8 px-2 text-red-600 hover:bg-red-50" onClick={() => call(() => api.delete(`${API}/projects/${project.id}/members/${encodeURIComponent(m.email)}`), 'Member removed')}><X className="w-4 h-4" /></Button>}
                </>
              ) : <span className="text-xs text-slate-500">{PROJECT_ROLES[m.role]?.label}</span>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <div className="flex-1"><PersonSelect people={people.filter(p => !memberEmails.has(p.email))} value={newMember.email} onChange={(v) => setNewMember(n => ({ ...n, email: v }))} placeholder="Choose a person" /></div>
            <Select value={newMember.role} onValueChange={(role) => setNewMember(n => ({ ...n, role }))}>
              <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PROJECT_ROLES).map(([k, r]) => <SelectItem key={k} value={k}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={addMember} disabled={!newMember.email} className="gap-1.5 bg-slate-800 hover:bg-slate-900"><UserPlus className="w-4 h-4" /> Add</Button>
          </div>
        )}
        <p className="text-[11px] text-slate-500 mt-2">{Object.values(PROJECT_ROLES).map(r => `${r.label}: ${r.hint.toLowerCase()}`).join(' · ')}</p>
      </Section>

      <Section title="Workflow" subtitle="Board columns in order. Each status belongs to a category used for progress and reports.">
        <div className="space-y-2">
          {statuses.map((s, i) => (
            <div key={s.key || `new-${i}`} className="flex flex-wrap items-center gap-2">
              <input type="color" value={s.color} disabled={!isAdmin} onChange={(e) => setStatuses(l => l.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} className="w-8 h-8 rounded cursor-pointer border border-slate-200 bg-white p-0.5" aria-label="Color" />
              <Input value={s.label} disabled={!isAdmin} onChange={(e) => setStatuses(l => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-8 w-44" />
              <Select value={s.category} onValueChange={(v) => setStatuses(l => l.map((x, j) => (j === i ? { ...x, category: v } : x)))} disabled={!isAdmin}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CATEGORIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <StatusBadge label={s.label || '…'} color={s.color} />
              {isAdmin && (
                <div className="flex gap-0.5 ml-auto">
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => moveStatus(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => moveStatus(i, 1)} disabled={i === statuses.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-red-600 hover:bg-red-50" onClick={() => setStatuses(l => l.filter((_, j) => j !== i))} disabled={statuses.length <= 2}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatuses(l => [...l, { key: '', label: 'New status', category: 'in_progress', color: '#64748b' }])}><Plus className="w-4 h-4" /> Add status</Button>
            <Button size="sm" className="gap-1 bg-slate-800 hover:bg-slate-900" onClick={() => call(() => api.put(`${API}/projects/${project.id}/statuses`, { statuses }), 'Workflow saved')}><Save className="w-4 h-4" /> Save workflow</Button>
            <p className="text-[11px] text-slate-500 w-full">Tasks in a removed status move to the first remaining status of the same category.</p>
          </div>
        )}
      </Section>

      <Section title="Labels">
        <div className="flex flex-wrap gap-2">
          {labels.map((l, i) => (
            <div key={l.id || `new-${i}`} className="flex items-center gap-1 rounded-lg border border-slate-200 pl-1 pr-1.5 py-1">
              <input type="color" value={l.color} disabled={!isAdmin} onChange={(e) => setLabels(list => list.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} className="w-6 h-6 rounded cursor-pointer p-0 border-0 bg-transparent" aria-label="Color" />
              <Input value={l.name} disabled={!isAdmin} onChange={(e) => setLabels(list => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-7 w-28 text-xs" />
              {isAdmin && <button type="button" onClick={() => setLabels(list => list.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setLabels(l => [...l, { name: 'New label', color: COLORS[(l.length + 2) % COLORS.length] }])}><Plus className="w-4 h-4" /> Add label</Button>
            <Button size="sm" className="gap-1 bg-slate-800 hover:bg-slate-900" disabled={labels.some(l => !l.name.trim())} onClick={() => call(() => api.put(`${API}/projects/${project.id}/labels`, { labels }), 'Labels saved')}><Save className="w-4 h-4" /> Save labels</Button>
          </div>
        )}
      </Section>

      <Section title="Danger zone">
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button variant="outline" className="gap-1.5" onClick={() => setConfirm('archive')}>
              {project.archived ? <><RotateCcw className="w-4 h-4" /> Restore project</> : <><Archive className="w-4 h-4" /> Archive project</>}
            </Button>
          )}
          {isAdmin && canDelete && <Button variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirm('delete')}><Trash2 className="w-4 h-4" /> Delete project</Button>}
          {memberEmails.has(me?.email) && me?.email !== project.lead_email && <Button variant="ghost" className="gap-1.5" onClick={leave}><LogOut className="w-4 h-4" /> Leave project</Button>}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">Archived projects are read-only and hidden from lists. Deleting removes all tasks, sprints, docs and PM time entries; approved HR timesheets are kept.</p>
      </Section>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'delete' ? `Delete ${project.name}?` : project.archived ? `Restore ${project.name}?` : `Archive ${project.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete' ? 'This permanently deletes the project and everything in it. This cannot be undone.' : project.archived ? 'The project becomes editable again.' : 'The project becomes read-only and is hidden from project lists. You can restore it later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm === 'delete' ? remove : archive} className={confirm === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'}>
              {confirm === 'delete' ? 'Delete' : project.archived ? 'Restore' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
