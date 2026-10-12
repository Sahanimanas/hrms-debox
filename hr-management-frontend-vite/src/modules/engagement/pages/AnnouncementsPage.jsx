import { useState } from 'react';
import { Megaphone, Plus, Pin, Pencil, Trash2, Eye, CalendarClock, Users, Clock, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import Markdown from '../components/Markdown';
import AudiencePicker from '../components/AudiencePicker';
import { PageShell, PageHeader, StateSwitch, ExportButton, ProgressBar, LoadingState, ErrorState } from '../components/PageShell';
import { API, PRIMARY_BTN, useApi, isAdmin, errorMessage, fmtDateTime, timeAgo, toLocalInput, fromLocalInput, audienceLabel } from '../lib';

const STATUS_STYLES = {
  live: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-sky-100 text-sky-700',
  expired: 'bg-slate-100 text-slate-500',
};

const EMPTY = { title: '', body: '', pinned: false, audience: { type: 'everyone', departments: [] }, publish_at: '', expires_at: '' };

function FeedItem({ item, onRead }) {
  const [open, setOpen] = useState(false);
  const long = item.body.length > 280 || item.body.split('\n').length > 4;

  const expand = () => {
    setOpen(o => !o);
    if (!item.is_read) onRead(item.id);
  };

  return (
    <Card className={`border-0 shadow-md ${item.pinned ? 'ring-1 ring-amber-200' : ''}`}>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {!item.is_read && <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" aria-label="Unread" />}
              <h3 className="font-semibold text-slate-900 text-sm sm:text-base break-words">{item.title}</h3>
              {item.pinned && (
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1 text-[10px]"><Pin className="w-3 h-3" />Pinned</Badge>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
              {item.created_by_name || 'HR'} · {timeAgo(item.published_at)}
              {item.audience?.type === 'departments' && <> · {audienceLabel(item.audience)}</>}
            </p>
          </div>
        </div>
        <Markdown text={item.body} clamp={open || !long ? 0 : 2} />
        <div className="flex items-center gap-3">
          {long && (
            <Button variant="link" className="h-auto p-0 text-xs text-sky-700" onClick={expand}>
              {open ? 'Show less' : 'Read more'}
            </Button>
          )}
          {!item.is_read && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-slate-600" onClick={() => onRead(item.id)}>
              <CheckCheck className="w-3.5 h-3.5" /> Mark as read
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Feed() {
  const { data, loading, error, reload, setData } = useApi(`${API}/announcements/feed`, { params: { limit: 50 } });
  const items = data?.announcements || [];

  const markRead = async (id) => {
    try {
      await api.post(`${API}/announcements/${id}/read`);
      setData(d => d && ({
        ...d,
        unread: Math.max(0, (d.unread || 0) - 1),
        announcements: d.announcements.map(a => (a.id === id ? { ...a, is_read: true } : a)),
      }));
    } catch (err) {
      toast.error(errorMessage(err, 'Could not mark as read'));
    }
  };

  return (
    <StateSwitch
      loading={loading}
      error={error}
      onRetry={reload}
      empty={!items.length}
      emptyProps={{ icon: Megaphone, title: 'No announcements right now', hint: 'Company news will show up here.' }}
    >
      <div className="space-y-3 sm:space-y-4">
        {data?.unread > 0 && <p className="text-xs text-slate-500">{data.unread} unread</p>}
        {items.map(item => <FeedItem key={item.id} item={item} onRead={markRead} />)}
      </div>
    </StateSwitch>
  );
}

function ReadersDialog({ announcement, onClose }) {
  const { data, loading, error, reload } = useApi(announcement ? `${API}/announcements/${announcement.id}/reads` : null);
  const download = () => {
    const rows = [
      ...(data?.reads || []).map(r => ({ ...r, state: 'Read' })),
      ...(data?.unread || []).map(r => ({ ...r, state: 'Not read' })),
    ];
    exportCsv(`announcement-reads`, rows, [
      { key: 'user_name', label: 'Name' },
      { key: 'user_email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'state', label: 'Status' },
      { label: 'Read at', value: r => (r.read_at ? new Date(r.read_at).toISOString() : '') },
    ]);
  };
  return (
    <Dialog open={!!announcement} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 break-words">Read receipts</DialogTitle>
          <DialogDescription className="break-words">{announcement?.title}</DialogDescription>
        </DialogHeader>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">{data.read_count} of {data.audience_size} read</span>
                <span className="font-semibold">{data.read_percent}%</span>
              </div>
              <ProgressBar value={data.read_percent} />
            </div>
            <Tabs defaultValue="read">
              <TabsList className="w-full">
                <TabsTrigger value="read" className="flex-1">Read ({data.reads.length})</TabsTrigger>
                <TabsTrigger value="unread" className="flex-1">Not read ({data.unread.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="read">
                <ul className="divide-y divide-slate-100 text-sm max-h-72 overflow-y-auto">
                  {data.reads.map(r => (
                    <li key={r.user_email} className="py-2 flex justify-between gap-2">
                      <span className="truncate">{r.user_name}<span className="block text-[11px] text-slate-500">{r.department || '—'}</span></span>
                      <span className="text-xs text-slate-500 shrink-0">{timeAgo(r.read_at)}</span>
                    </li>
                  ))}
                  {!data.reads.length && <li className="py-6 text-center text-xs text-slate-500">Nobody has read it yet</li>}
                </ul>
              </TabsContent>
              <TabsContent value="unread">
                <ul className="divide-y divide-slate-100 text-sm max-h-72 overflow-y-auto">
                  {data.unread.map(r => (
                    <li key={r.user_email} className="py-2">
                      {r.user_name}<span className="block text-[11px] text-slate-500">{r.department || '—'}</span>
                    </li>
                  ))}
                  {!data.unread.length && <li className="py-6 text-center text-xs text-slate-500">Everyone has read it</li>}
                </ul>
              </TabsContent>
            </Tabs>
          </div>
        )}
        <DialogFooter className="gap-2">
          <ExportButton onClick={download} disabled={!data} />
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditorDialog({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial || EMPTY);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const editing = !!initial?.id;
  const published = editing && initial.status !== 'scheduled';
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return toast.error('Title and message are required');
    if (form.audience.type === 'departments' && !form.audience.departments.length) return toast.error('Pick at least one department');
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      pinned: form.pinned,
      audience: form.audience,
      expires_at: fromLocalInput(form.expires_at),
    };
    if (!published) payload.publish_at = fromLocalInput(form.publish_at);
    setSaving(true);
    try {
      if (editing) await api.put(`${API}/announcements/${initial.id}`, payload);
      else await api.post(`${API}/announcements`, payload);
      toast.success(editing ? 'Announcement updated' : payload.publish_at ? 'Announcement scheduled' : 'Announcement published');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit announcement' : 'New announcement'}</DialogTitle>
          <DialogDescription>Supports **bold**, *italics*, [links](https://…) and "- " bullet lists.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Title</Label>
            <Input id="ann-title" value={form.title} maxLength={200} onChange={e => set('title', e.target.value)} placeholder="e.g. Office closed on Friday" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ann-body">Message</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreview(p => !p)}>
                {preview ? 'Edit' : 'Preview'}
              </Button>
            </div>
            {preview ? (
              <div className="min-h-[140px] rounded-md border border-slate-200 p-3 bg-slate-50">
                <Markdown text={form.body || '_Nothing to preview_'} />
              </div>
            ) : (
              <Textarea id="ann-body" rows={7} value={form.body} maxLength={20000} onChange={e => set('body', e.target.value)} />
            )}
          </div>
          <AudiencePicker value={form.audience} onChange={v => set('audience', v)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ann-publish">Publish at</Label>
              <Input id="ann-publish" type="datetime-local" value={form.publish_at} disabled={published} onChange={e => set('publish_at', e.target.value)} />
              <p className="text-[11px] text-slate-500">{published ? 'Already published' : 'Leave empty to publish now'}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-expiry">Expires at (optional)</Label>
              <Input id="ann-expiry" type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={form.pinned} onCheckedChange={v => set('pinned', v)} />
            Pin to the top of the feed
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-slate-800 hover:bg-slate-900" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : form.publish_at ? 'Schedule' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Manage() {
  const [status, setStatus] = useState('all');
  const { data, loading, error, reload } = useApi(`${API}/announcements`, { initial: [] });
  const [editing, setEditing] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const [readers, setReaders] = useState(null);
  const rows = (data || []).filter(a => status === 'all' || a.status === status);

  const openEditor = (a) => {
    setEditing(a ? {
      ...a,
      publish_at: a.status === 'scheduled' ? toLocalInput(a.published_at) : '',
      expires_at: toLocalInput(a.expires_at),
    } : EMPTY);
    setEditorKey(k => k + 1);
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    try {
      await api.delete(`${API}/announcements/${a.id}`);
      toast.success('Announcement deleted');
      reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete'));
    }
  };

  const download = () => exportCsv('announcements', rows, [
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { label: 'Pinned', value: r => (r.pinned ? 'Yes' : 'No') },
    { label: 'Audience', value: r => audienceLabel(r.audience) },
    { label: 'Published at', value: r => r.published_at },
    { label: 'Expires at', value: r => r.expires_at || '' },
    { key: 'read_count', label: 'Reads' },
    { key: 'audience_size', label: 'Audience size' },
    { key: 'created_by_name', label: 'Author' },
  ]);

  const counts = (data || []).reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {});

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {['all', 'live', 'scheduled', 'expired'].map(s => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1 rounded-full text-xs border capitalize ${status === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {s}{s !== 'all' && counts[s] ? ` (${counts[s]})` : ''}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <ExportButton onClick={download} disabled={!rows.length} />
            <Button className={PRIMARY_BTN} onClick={() => openEditor(null)}><Plus className="w-4 h-4" />New announcement</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StateSwitch
          loading={loading}
          error={error}
          onRetry={reload}
          empty={!rows.length}
          emptyProps={{ icon: Megaphone, title: 'No announcements', hint: 'Post company news, schedule it, or pin it to the top.' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Announcement</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Audience</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Published</th>
                  <th className="text-left font-medium px-4 py-3">Reads</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 min-w-[160px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.pinned && <Pin className="w-3.5 h-3.5 text-amber-500" />}
                        <span className="font-medium text-slate-900 break-words">{a.title}</span>
                      </div>
                      <Badge variant="outline" className={`${STATUS_STYLES[a.status]} border-0 text-[10px] mt-1 capitalize`}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-600 text-xs">{audienceLabel(a.audience)}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-slate-600 whitespace-nowrap">
                      <span className="flex items-center gap-1">{a.status === 'scheduled' ? <CalendarClock className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}{fmtDateTime(a.published_at)}</span>
                      {a.expires_at && <span className="block text-[11px] text-slate-400">Expires {fmtDateTime(a.expires_at)}</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button className="flex items-center gap-1 text-xs text-sky-700 hover:underline" onClick={() => setReaders(a)}>
                        <Users className="w-3.5 h-3.5" />{a.read_count}/{a.audience_size}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setReaders(a)} aria-label="Read receipts"><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditor(a)} aria-label="Edit"><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => remove(a)} aria-label="Delete"><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateSwitch>
      </CardContent>
      {editing && (
        <EditorDialog
          key={editorKey}
          open={!!editing}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      <ReadersDialog announcement={readers} onClose={() => setReaders(null)} />
    </Card>
  );
}

export default function AnnouncementsPage() {
  const admin = isAdmin();
  return (
    <PageShell>
      <PageHeader icon={Megaphone} title="Announcements" subtitle="Company news and updates" />
      {admin ? (
        <Tabs defaultValue="feed">
          <TabsList>
            <TabsTrigger value="feed">Feed</TabsTrigger>
            <TabsTrigger value="manage">Manage</TabsTrigger>
          </TabsList>
          <TabsContent value="feed" className="mt-4"><Feed /></TabsContent>
          <TabsContent value="manage" className="mt-4"><Manage /></TabsContent>
        </Tabs>
      ) : (
        <Feed />
      )}
    </PageShell>
  );
}
