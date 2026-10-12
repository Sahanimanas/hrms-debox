import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, Grid3x3, TrendingDown, Settings2, Plus, Trash2, Pencil, ShieldCheck, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PF, useApi, apiError, currentUser, isLead, heatClass } from '../lib';
import { PageShell, SectionCard, DataState, Pill, ExportButton, SimpleSelect, DataTable } from '../components/common';

const LEVELS = [
  { value: '1', label: '1 — Beginner' },
  { value: '2', label: '2 — Basic' },
  { value: '3', label: '3 — Proficient' },
  { value: '4', label: '4 — Advanced' },
  { value: '5', label: '5 — Expert' },
];
const NONE = '__none__';
const LEVEL_OPTIONS = [{ value: NONE, label: 'Not rated' }, ...LEVELS];

function MySkills() {
  const mine = useApi(`${PF}/skills/me`);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const rows = mine.data || [];
  const value = (r) => (draft[r.skill_id] !== undefined ? draft[r.skill_id] : r.self_rating);
  const changed = Object.keys(draft).filter(id => draft[id] !== rows.find(r => r.skill_id === id)?.self_rating);
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`${PF}/skills/me`, { ratings: changed.map(id => ({ skill_id: id, rating: draft[id] })) });
      toast.success('Skills saved — your manager will validate them');
      setDraft({});
      mine.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <SectionCard
      icon={Sparkles}
      title="My skills"
      actions={(
        <>
          <ExportButton disabled={!rows.length} onClick={() => exportCsv('my-skills', rows, [
            { key: 'name', label: 'Skill' }, { key: 'category', label: 'Category' }, { key: 'self_rating', label: 'Self rating' },
            { key: 'manager_rating', label: 'Manager rating' }, { key: 'target_level', label: 'Target' },
          ])} />
          <Button size="sm" className="bg-slate-800 hover:bg-slate-900" onClick={save} disabled={!changed.length || saving}><Save className="w-4 h-4 mr-1" /> Save{changed.length ? ` (${changed.length})` : ''}</Button>
        </>
      )}
    >
      <DataState state={mine} empty={!rows.length} emptyText="Your admin hasn't set up a skills catalog yet" emptyIcon={Sparkles}>
        <DataTable
          rowKey="skill_id"
          rows={rows}
          columns={[
            { key: 'name', label: 'Skill', render: r => <div><p className="font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{r.category}</p></div> },
            { key: 'self', label: 'My rating', render: r => (
              <SimpleSelect className="w-40" value={value(r) ? String(value(r)) : NONE} onChange={(v) => setDraft(d => ({ ...d, [r.skill_id]: v === NONE ? null : Number(v) }))} options={LEVEL_OPTIONS} />
            ) },
            { key: 'manager', label: 'Manager', render: r => (r.manager_rating
              ? <span title={r.manager_comment || ''}>{r.manager_rating} <span className="text-xs text-slate-500">· {r.validated_by_name}</span></span>
              : r.self_rating ? <Pill tone="amber">Pending</Pill> : '—') },
            { key: 'target', label: 'Role target', hideOnMobile: true, render: r => r.target_level ?? '—' },
            { key: 'gap', label: 'Gap', hideOnMobile: true, render: r => {
              if (!r.target_level) return '—';
              const gap = r.target_level - (r.manager_rating ?? r.self_rating ?? 0);
              return gap > 0 ? <Pill tone="rose">-{gap}</Pill> : <Pill tone="emerald">Met</Pill>;
            } },
          ]}
        />
      </DataState>
    </SectionCard>
  );
}

function ValidateForm({ employee, skills, onClose, onSaved }) {
  const [ratings, setRatings] = useState(() => Object.fromEntries(skills.map(s => {
    const r = employee.ratings[s.id];
    return [s.id, r ? (r.manager ?? r.self) : null];
  })));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const list = Object.entries(ratings).filter(([, v]) => v).map(([skill_id, rating]) => ({ skill_id, rating }));
    if (!list.length) return toast.error('Rate at least one skill');
    setSaving(true);
    try {
      await api.put(`${PF}/skills/employee/${encodeURIComponent(employee.email)}/validate`, { ratings: list });
      toast.success('Skills validated');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to validate'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader><DialogTitle>Validate {employee.full_name}&apos;s skills</DialogTitle></DialogHeader>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {skills.map(s => {
          const r = employee.ratings[s.id];
          return (
            <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-slate-500">Self: {r?.self ?? '—'}{r?.manager ? ` · validated: ${r.manager}` : ''}</p>
              </div>
              <SimpleSelect className="sm:w-40" value={ratings[s.id] ? String(ratings[s.id]) : NONE} onChange={(v) => setRatings(x => ({ ...x, [s.id]: v === NONE ? null : Number(v) }))} options={LEVEL_OPTIONS} />
            </div>
          );
        })}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-slate-800 hover:bg-slate-900">Validate</Button>
      </DialogFooter>
    </>
  );
}

function TeamMatrix({ isAdmin }) {
  const [scope, setScope] = useState(isAdmin ? 'all' : 'team');
  const [department, setDepartment] = useState('any');
  const matrix = useApi(`${PF}/skills/matrix`, { scope, ...(department !== 'any' ? { department } : {}) });
  const [validating, setValidating] = useState(null);
  const skills = matrix.data?.skills || [];
  const employees = useMemo(() => matrix.data?.employees || [], [matrix.data]);
  const departments = useMemo(() => [...new Set(employees.map(e => e.department).filter(Boolean))].sort(), [employees]);
  return (
    <SectionCard
      icon={Grid3x3}
      title="Skill matrix"
      actions={(
        <>
          {isAdmin && <SimpleSelect className="h-8 w-32" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Everyone' }, { value: 'team', label: 'My team' }]} />}
          <SimpleSelect className="h-8 w-40" value={department} onChange={setDepartment} options={[{ value: 'any', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]} />
          <ExportButton disabled={!employees.length} onClick={() => exportCsv('skill-matrix', employees, [
            { key: 'full_name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
            ...skills.map(s => ({ label: s.name, value: (e) => e.ratings[s.id]?.effective ?? '' })),
          ])} />
        </>
      )}
    >
      <DataState state={matrix} empty={!employees.length || !skills.length} emptyText={!skills.length ? 'No skills in the catalog yet' : 'Nobody in scope'} emptyIcon={Grid3x3}>
        <div className="overflow-x-auto">
          <table className="text-sm min-w-full">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left font-medium px-3 py-3 sticky left-0 bg-slate-50 min-w-[10rem]">Employee</th>
                {skills.map(s => <th key={s.id} className="font-medium px-2 py-3 text-center whitespace-nowrap">{s.name}</th>)}
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map(e => (
                <tr key={e.email}>
                  <td className="px-3 py-2 sticky left-0 bg-white">
                    <p className="font-medium text-slate-900 whitespace-nowrap">{e.full_name}</p>
                    <p className="text-[11px] text-slate-500 whitespace-nowrap">{e.designation}</p>
                  </td>
                  {skills.map(s => {
                    const r = e.ratings[s.id];
                    return (
                      <td key={s.id} className="px-1 py-1 text-center">
                        <div className={`rounded-md h-9 min-w-[2.5rem] flex items-center justify-center font-semibold ${heatClass(r?.effective)} ${r?.status === 'pending_validation' ? 'ring-2 ring-amber-400 ring-inset' : ''}`}
                          title={r ? `Self ${r.self ?? '—'} · Manager ${r.manager ?? '—'}` : 'Not rated'}>
                          {r?.effective ?? '·'}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right">
                    {(
                      <Button size="sm" variant={e.pending_validation ? 'default' : 'ghost'} className={e.pending_validation ? 'bg-amber-500 hover:bg-amber-600' : ''} onClick={() => setValidating(e)}>
                        <ShieldCheck className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">{e.pending_validation ? `Validate (${e.pending_validation})` : 'Review'}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 px-4 py-2">Cells show the validated rating (or the self rating until validated). Amber outline = awaiting validation.</p>
      </DataState>
      <Dialog open={!!validating} onOpenChange={(o) => !o && setValidating(null)}>
        <DialogContent className="sm:max-w-lg">
          {validating && <ValidateForm employee={validating} skills={skills} onClose={() => setValidating(null)} onSaved={matrix.reload} />}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function Gaps({ lead, isAdmin }) {
  const [scope, setScope] = useState(lead ? 'team' : 'my');
  const gaps = useApi(`${PF}/skills/gaps`, { scope });
  const employees = (gaps.data?.employees || []).filter(e => e.targets_defined > 0);
  const bySkill = gaps.data?.by_skill || [];
  return (
    <div className="space-y-4">
      {lead && (
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList>
            <TabsTrigger value="team">My team</TabsTrigger>
            {isAdmin && <TabsTrigger value="all">Everyone</TabsTrigger>}
            <TabsTrigger value="my">Me</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {bySkill.length > 0 && scope !== 'my' && (
        <SectionCard icon={TrendingDown} title="Biggest gaps by skill">
          <DataTable rowKey="skill_id" rows={bySkill} columns={[
            { key: 'name', label: 'Skill', render: s => <span className="font-medium">{s.name}</span> },
            { key: 'with_gap', label: 'People below target', render: s => `${s.with_gap} / ${s.people}` },
            { key: 'total_gap', label: 'Total gap (levels)' },
          ]} />
        </SectionCard>
      )}
      <SectionCard
        icon={TrendingDown}
        title="Skill gaps against role targets"
        actions={<ExportButton disabled={!employees.length} onClick={() => exportCsv('skill-gaps', employees.flatMap(e => e.gaps.map(g => ({ ...g, employee: e.full_name, designation: e.designation }))), [
          { key: 'employee', label: 'Employee' }, { key: 'designation', label: 'Designation' }, { key: 'name', label: 'Skill' },
          { key: 'target', label: 'Target' }, { key: 'current', label: 'Current' }, { key: 'gap', label: 'Gap' },
        ])} />}
        bodyClassName="p-3 sm:p-5"
      >
        <DataState state={gaps} empty={!employees.length} emptyText="No role targets apply here yet" emptyIcon={TrendingDown}>
          <div className="space-y-4">
            {employees.map(e => (
              <div key={e.email} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{e.full_name} <span className="text-xs text-slate-500 font-normal">· {e.designation}</span></p>
                  {e.total_gap > 0 ? <Pill tone="rose">{e.total_gap} level gap</Pill> : <Pill tone="emerald">All targets met</Pill>}
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {e.gaps.map(g => (
                    <div key={g.skill_id} className="text-sm">
                      <div className="flex justify-between text-xs mb-1"><span>{g.name}</span><span className="text-slate-500">{g.current} / {g.target}{g.validated ? '' : ' (self)'}</span></div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full ${g.gap > 0 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, (g.current / g.target) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </SectionCard>
    </div>
  );
}

function SkillAdmin() {
  const skills = useApi(`${PF}/skills`);
  const people = useApi(`${PF}/people`, { scope: 'all' });
  const [designation, setDesignation] = useState('');
  const targets = useApi(designation ? `${PF}/skills/targets` : null, { designation });
  const [form, setForm] = useState({ name: '', category: '' });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const list = skills.data || [];
  const designations = people.data?.designations || [];
  const targetFor = (id) => (draft[id] !== undefined ? draft[id] : targets.data?.find(t => t.skill_id === id)?.level ?? null);

  const add = async () => {
    if (!form.name.trim()) return toast.error('Skill name required');
    try {
      await api.post(`${PF}/skills`, { name: form.name.trim(), category: form.category.trim() || null });
      setForm({ name: '', category: '' });
      skills.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to add skill'));
    }
  };
  const saveEdit = async () => {
    try {
      await api.put(`${PF}/skills/${editing.id}`, { name: editing.name.trim(), category: editing.category || null });
      setEditing(null);
      skills.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to update skill'));
    }
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete "${s.name}"? Ratings and targets for it are removed too.`)) return;
    try {
      await api.delete(`${PF}/skills/${s.id}`);
      skills.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to delete skill'));
    }
  };
  const saveTargets = async () => {
    const entries = Object.entries(draft);
    if (!entries.length) return;
    try {
      await api.put(`${PF}/skills/targets`, { designation, targets: entries.map(([skill_id, level]) => ({ skill_id, level })) });
      toast.success('Targets saved');
      setDraft({});
      targets.reload();
    } catch (error) {
      toast.error(apiError(error, 'Failed to save targets'));
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <SectionCard icon={Settings2} title="Skills catalog" bodyClassName="p-3 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Skill name" />
          <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" className="sm:w-36" />
          <Button variant="outline" onClick={add}><Plus className="w-4 h-4" /></Button>
        </div>
        <DataState state={skills} empty={!list.length} emptyText="No skills yet" emptyIcon={Sparkles}>
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {list.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><span className="font-medium">{s.name}</span> <span className="text-xs text-slate-500">· {s.category}</span></span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing({ ...s })} aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(s)} aria-label="Delete"><Trash2 className="w-3.5 h-3.5 text-rose-500" /></Button>
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </SectionCard>
      <SectionCard icon={TrendingDown} title="Role targets" bodyClassName="p-3 sm:p-5 space-y-3">
        <div className="space-y-1.5">
          <Label>Designation</Label>
          <SimpleSelect value={designation} onChange={(v) => { setDesignation(v); setDraft({}); }} options={designations.map(d => ({ value: d, label: d }))} placeholder="Choose a designation" />
        </div>
        {designation && (
          <DataState state={targets}>
            <div className="space-y-2">
              {list.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{s.name}</span>
                  <SimpleSelect className="w-40" value={targetFor(s.id) ? String(targetFor(s.id)) : NONE} onChange={(v) => setDraft(d => ({ ...d, [s.id]: v === NONE ? null : Number(v) }))} options={[{ value: NONE, label: 'No target' }, ...LEVELS]} />
                </div>
              ))}
              <div className="flex justify-end"><Button onClick={saveTargets} disabled={!Object.keys(draft).length} className="bg-slate-800 hover:bg-slate-900">Save targets</Button></div>
            </div>
          </DataState>
        )}
      </SectionCard>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit skill</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="sk-name">Name</Label><Input id="sk-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sk-cat">Category</Label><Input id="sk-cat" value={editing.category || ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} className="bg-slate-800 hover:bg-slate-900">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SkillsPage = () => {
  const user = currentUser();
  const lead = isLead(user);
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'my';
  const setTab = (t) => setParams(p => { p.set('tab', t); return p; }, { replace: true });
  return (
    <PageShell icon={Sparkles} title="Skills" subtitle="Self-assessed and manager-validated skills, team matrix and gaps">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
          <TabsTrigger value="my">My skills</TabsTrigger>
          {lead && <TabsTrigger value="team">Team matrix</TabsTrigger>}
          <TabsTrigger value="gaps">Skill gaps</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin">Catalog &amp; targets</TabsTrigger>}
        </TabsList>
        <TabsContent value="my"><MySkills /></TabsContent>
        {lead && <TabsContent value="team"><TeamMatrix isAdmin={isAdmin} /></TabsContent>}
        <TabsContent value="gaps"><Gaps lead={lead} isAdmin={isAdmin} /></TabsContent>
        {isAdmin && <TabsContent value="admin"><SkillAdmin /></TabsContent>}
      </Tabs>
    </PageShell>
  );
};

export default SkillsPage;
