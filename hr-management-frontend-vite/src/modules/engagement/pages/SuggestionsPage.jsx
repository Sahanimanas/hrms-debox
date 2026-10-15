import { useState } from 'react';
import { Lightbulb, Send, EyeOff, MessageSquareReply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, StateSwitch, ExportButton } from '../components/PageShell';
import { API, useApi, isAdmin, errorMessage, fmtDate, timeAgo, titleCase } from '../lib';

const CATEGORIES = ['workplace', 'process', 'culture', 'benefits', 'technology', 'other'];
const STATUSES = ['new', 'under_review', 'implemented', 'declined'];
const STATUS_STYLES = {
  new: 'bg-sky-100 text-sky-700',
  under_review: 'bg-amber-100 text-amber-700',
  implemented: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-slate-200 text-slate-600',
};
const StatusBadge = ({ status }) => (
  <Badge variant="outline" className={`${STATUS_STYLES[status]} border-0 text-[10px]`}>{titleCase(status)}</Badge>
);

function SubmitForm({ onSubmitted }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'other', anonymous: false });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (form.title.trim().length < 3) return toast.error('Give your suggestion a short title');
    if (!form.description.trim()) return toast.error('Describe your suggestion');
    setSaving(true);
    try {
      await api.post(`${API}/suggestions`, { ...form, title: form.title.trim(), description: form.description.trim() });
      toast.success(form.anonymous ? 'Thanks! Your anonymous suggestion was submitted' : 'Thanks! You can follow its status below');
      setForm({ title: '', description: '', category: 'other', anonymous: false });
      onSubmitted();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not submit'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2"><Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />Share an idea</CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sg-title">Title</Label>
            <Input id="sg-title" value={form.title} maxLength={200} onChange={e => set('title', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={v => set('category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sg-desc">Details</Label>
          <Textarea id="sg-desc" rows={4} maxLength={5000} value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={form.anonymous} onCheckedChange={v => set('anonymous', v)} className="mt-0.5" />
            <span>Submit anonymously<span className="block text-xs text-slate-500">Your name isn't stored — you won't be able to track it.</span></span>
          </label>
          <Button className="gap-2 w-full sm:w-auto" onClick={submit} disabled={saving}><Send className="w-4 h-4" />{saving ? 'Submitting…' : 'Submit'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MySuggestions({ version }) {
  const { data, loading, error, reload } = useApi(`${API}/suggestions/mine`, { initial: [], params: { v: version } });
  const list = data || [];
  const download = () => exportCsv('my-suggestions', list, [
    { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' },
    { key: 'admin_response', label: 'Response' }, { label: 'Submitted', value: r => r.created_at },
  ]);
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5 flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base sm:text-lg">My suggestions</CardTitle>
        <ExportButton onClick={download} disabled={!list.length} />
      </CardHeader>
      <CardContent className="p-0">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
          emptyProps={{ icon: Lightbulb, title: 'No suggestions yet', hint: 'Anonymous suggestions are not listed here.' }}>
          <ul className="divide-y divide-slate-100">
            {list.map(s => (
              <li key={s.id} className="p-3 sm:p-4 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm text-slate-900 break-words">{s.title}</span>
                  <StatusBadge status={s.status} />
                  <span className="text-[11px] text-slate-500">{titleCase(s.category)} · {timeAgo(s.created_at)}</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 whitespace-pre-line break-words">{s.description}</p>
                {s.admin_response && (
                  <p className="text-xs sm:text-sm bg-slate-50 rounded-lg px-3 py-2 text-slate-700 flex gap-2">
                    <MessageSquareReply className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <span><span className="font-medium">{s.responded_by_name || 'HR'}:</span> {s.admin_response}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </StateSwitch>
      </CardContent>
    </Card>
  );
}

function ReviewDialog({ suggestion, onClose, onSaved }) {
  const [status, setStatus] = useState(suggestion.status);
  const [response, setResponse] = useState(suggestion.admin_response || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`${API}/suggestions/${suggestion.id}`, { status, admin_response: response.trim() });
      toast.success('Suggestion updated');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 break-words">{suggestion.title}</DialogTitle>
          <DialogDescription>
            {suggestion.anonymous ? 'Anonymous' : `${suggestion.submitter_name}${suggestion.submitter_department ? ` · ${suggestion.submitter_department}` : ''}`} · {fmtDate(suggestion.created_at)} · {titleCase(suggestion.category)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-700 whitespace-pre-line break-words bg-slate-50 rounded-lg p-3">{suggestion.description}</p>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sg-resp">Response {suggestion.anonymous ? '(not delivered — anonymous)' : '(visible to the submitter)'}</Label>
          <Textarea id="sg-resp" rows={3} maxLength={5000} value={response} onChange={e => setResponse(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageSuggestions() {
  const [status, setStatus] = useState('all');
  const { data, loading, error, reload } = useApi(`${API}/suggestions`, { params: status === 'all' ? {} : { status } });
  const [reviewing, setReviewing] = useState(null);
  const list = data?.suggestions || [];
  const download = () => exportCsv('suggestions', list, [
    { key: 'title', label: 'Title' }, { key: 'description', label: 'Details' }, { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' }, { label: 'Submitted by', value: r => (r.anonymous ? 'Anonymous' : r.submitter_name) },
    { key: 'submitter_department', label: 'Department' }, { key: 'admin_response', label: 'Response' }, { label: 'Submitted', value: r => r.created_at },
  ]);
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {['all', ...STATUSES].map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-3 py-1 rounded-full text-xs border ${status === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {titleCase(s)}{s !== 'all' && data?.counts?.[s] ? ` (${data.counts[s]})` : ''}
              </button>
            ))}
          </div>
          <ExportButton onClick={download} disabled={!list.length} />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length} emptyProps={{ icon: Lightbulb, title: 'No suggestions here' }}>
          <ul className="divide-y divide-slate-100">
            {list.map(s => (
              <li key={s.id}>
                <button className="w-full text-left p-3 sm:p-4 hover:bg-slate-50 space-y-1" onClick={() => setReviewing(s)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm text-slate-900 break-words">{s.title}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                    {s.anonymous ? <><EyeOff className="w-3 h-3" />Anonymous</> : s.submitter_name} · {titleCase(s.category)} · {timeAgo(s.created_at)}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 break-words">{s.description}</p>
                </button>
              </li>
            ))}
          </ul>
        </StateSwitch>
      </CardContent>
      {reviewing && <ReviewDialog key={reviewing.id} suggestion={reviewing} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); reload(); }} />}
    </Card>
  );
}

export default function SuggestionsPage() {
  const admin = isAdmin();
  const [version, setVersion] = useState(0);
  const mine = (
    <div className="space-y-5">
      <SubmitForm onSubmitted={() => setVersion(v => v + 1)} />
      <MySuggestions version={version} />
    </div>
  );
  return (
    <PageShell>
      <PageHeader icon={Lightbulb} title="Suggestion box" subtitle="Ideas to make work better — named or anonymous" />
      {admin ? (
        <Tabs defaultValue="review">
          <TabsList>
            <TabsTrigger value="review">Review</TabsTrigger>
            <TabsTrigger value="submit">Submit</TabsTrigger>
          </TabsList>
          <TabsContent value="review" className="mt-4"><ManageSuggestions /></TabsContent>
          <TabsContent value="submit" className="mt-4">{mine}</TabsContent>
        </Tabs>
      ) : mine}
    </PageShell>
  );
}
