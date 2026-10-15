import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { X, Lock, Globe } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { API, COLORS, errorText } from '../lib';
import { usePeople, usePmMeta } from '../hooks';
import { Avatar, PersonSelect, StatusBadge } from './Shared';

const suggestKey = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const key = words.length === 1 ? words[0].slice(0, 4) : words.map(w => w[0]).join('').slice(0, 5);
  return /^[A-Z]/.test(key) ? key : `P${key}`.slice(0, 5);
};

/** Create a project from a template, with team members picked from HR. */
export default function ProjectFormDialog({ open, onOpenChange, onCreated }) {
  const people = usePeople();
  const meta = usePmMeta();
  const me = getAuth().user;
  const [form, setForm] = useState(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ name: '', key: '', description: '', template: 'kanban', color: COLORS[1], visibility: 'private', lead_email: me?.email || '', member_emails: [], start_date: '', due_date: '', client: '', budget_hours: '' });
    setKeyTouched(false);
  }, [open, me?.email]);

  if (!form) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const template = meta?.templates.find(t => t.key === form.template);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post(`${API}/projects`, {
        ...form,
        lead_email: form.lead_email || null,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        budget_hours: form.budget_hours === '' ? null : Number(form.budget_hours),
      });
      toast.success(`Project ${r.data.key} created`);
      onCreated?.(r.data);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, 'Failed to create project'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create project</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Template</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
              {(meta?.templates || []).map(t => (
                <button key={t.key} type="button" onClick={() => set('template', t.key)} data-testid={`template-${t.key}`}
                  className={`rounded-lg border-2 p-2.5 text-left transition-colors ${form.template === t.key ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                  <p className="text-sm font-semibold text-slate-900">{t.label}</p>
                  <p className="text-[11px] text-slate-500 capitalize">{t.methodology}{t.methodology === 'scrum' ? ' · sprints' : ' · flow'}</p>
                </button>
              ))}
            </div>
            {template && (
              <div className="flex flex-wrap gap-1 mt-2">
                {template.statuses.map(s => <StatusBadge key={s.key} label={s.label} color={s.color} />)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
            <div>
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" data-testid="project-name-input" required autoFocus maxLength={100} value={form.name} className="mt-1"
                onChange={(e) => { set('name', e.target.value); if (!keyTouched) set('key', suggestKey(e.target.value)); }} placeholder="Website redesign" />
            </div>
            <div>
              <Label htmlFor="project-key">Key</Label>
              <Input id="project-key" data-testid="project-key-input" required maxLength={10} value={form.key} className="mt-1 uppercase"
                onChange={(e) => { setKeyTouched(true); set('key', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} placeholder="WEB" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 -mt-2">Task IDs use the key, e.g. {form.key || 'KEY'}-42. The key also becomes the project code on HR timesheets.</p>

          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} className="mt-1" placeholder="Goal and scope of the project" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Project lead</Label>
              <PersonSelect people={people} value={form.lead_email} onChange={(v) => set('lead_email', v)} allowNone={false} placeholder="Choose a lead" className="mt-1" />
            </div>
            <div>
              <Label>Visibility</Label>
              <Select value={form.visibility} onValueChange={(v) => set('visibility', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private"><span className="flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> Private — members only</span></SelectItem>
                  <SelectItem value="organization"><span className="flex items-center gap-2"><Globe className="w-3.5 h-3.5" /> Organization — everyone can view</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Team members</Label>
            <Select value="" onValueChange={(email) => !form.member_emails.includes(email) && set('member_emails', [...form.member_emails, email])}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Add people from the employee directory" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {people.filter(p => !form.member_emails.includes(p.email) && p.email !== form.lead_email).map(p => (
                  <SelectItem key={p.email} value={p.email}>{p.name}{p.department ? ` · ${p.department}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.member_emails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.member_emails.map(email => {
                  const p = people.find(x => x.email === email);
                  return (
                    <span key={email} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 pl-1 pr-2 py-0.5 text-xs">
                      <Avatar name={p?.name || email} picture={p?.picture} size="xs" />{p?.name || email}
                      <button type="button" onClick={() => set('member_emails', form.member_emails.filter(x => x !== email))} className="text-slate-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Start</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Target end</Label>
              <Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Client</Label>
              <Input value={form.client} onChange={(e) => set('client', e.target.value)} className="mt-1" placeholder="Internal" />
            </div>
            <div>
              <Label>Budget (h)</Label>
              <Input type="number" min="0" value={form.budget_hours} onChange={(e) => set('budget_hours', e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => set('color', c)} aria-label={c}
                  className={`w-7 h-7 rounded-lg ${form.color === c ? 'ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.name.trim() || form.key.length < 2} data-testid="project-create-submit">
              {saving ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
