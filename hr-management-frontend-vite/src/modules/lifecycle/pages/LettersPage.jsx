import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileSignature, Plus, Pencil, Trash2, Eye, FileDown, Download, AlertTriangle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate, humanize, downloadFile } from '../lib';
import { useEmployees } from '../hooks';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, NativeSelect } from '../components/ui';

const TYPES = ['offer', 'appointment', 'experience', 'relieving', 'other'];
const EMPTY = { name: '', type: 'other', title: '', body: '' };

const LettersPage = () => {
  const [templates, setTemplates] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [issued, setIssued] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gen, setGen] = useState({ template_id: '', employee_uid: '' });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const bodyRef = useRef(null);
  const employees = useEmployees(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, p, i] = await Promise.all([
        api.get(`${API}/letters/templates`),
        api.get(`${API}/letters/placeholders`),
        api.get(`${API}/letters/issued`),
      ]);
      setTemplates(t.data || []);
      setPlaceholders(p.data || []);
      setIssued(i.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load letters'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const doPreview = async () => {
    if (!gen.template_id || !gen.employee_uid) return toast.error('Choose a template and an employee');
    setBusy(true);
    try {
      const r = await api.post(`${API}/letters/preview`, gen);
      setPreview(r.data);
    } catch (e) {
      toast.error(errMsg(e, 'Preview failed'));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (preview?.missing?.length && !window.confirm(`Some fields are empty (${preview.missing.join(', ')}). They will appear as blanks. Generate anyway?`)) return;
    setBusy(true);
    try {
      const r = await api.post(`${API}/letters/generate`, { ...gen, allow_missing: true });
      toast.success('Letter generated and saved to the employee’s documents');
      setPreview(null);
      load();
      downloadFile(`${API}/documents/${r.data.id}/download`, r.data.file_name).catch(() => {});
    } catch (e) {
      toast.error(errMsg(e, 'Failed to generate'));
    } finally {
      setBusy(false);
    }
  };

  const insertPlaceholder = (key) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setEditing({ ...editing, body: `${editing.body}${token}` });
    const start = el.selectionStart ?? editing.body.length;
    const end = el.selectionEnd ?? start;
    const body = editing.body.slice(0, start) + token + editing.body.slice(end);
    setEditing({ ...editing, body });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const saveTemplate = async () => {
    if (!editing.name.trim() || editing.body.trim().length < 10) return toast.error('Name and a body of at least 10 characters are required');
    setBusy(true);
    try {
      const body = { name: editing.name, type: editing.type, title: editing.title || '', body: editing.body };
      if (editing.id) await api.put(`${API}/letters/templates/${editing.id}`, body);
      else await api.post(`${API}/letters/templates`, body);
      toast.success('Template saved');
      setEditing(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to save template'));
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"? Letters already issued are kept.`)) return;
    try {
      await api.delete(`${API}/letters/templates/${t.id}`);
      toast.success('Template deleted');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to delete'));
    }
  };

  return (
    <PageShell>
      <PageHeader icon={FileSignature} title="Letters" subtitle="Generate offer, appointment, experience and relieving letters from templates" />
      {loading && !templates.length ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">Generate</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="issued">Issued ({issued.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4">
            <SectionCard icon={FileSignature} title="Generate a letter">
              <div className="p-3 sm:p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label>Template</Label>
                    <NativeSelect value={gen.template_id} onChange={(v) => { setGen({ ...gen, template_id: v }); setPreview(null); }}>
                      <option value="">Choose template…</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Employee</Label>
                    <NativeSelect value={gen.employee_uid} onChange={(v) => { setGen({ ...gen, employee_uid: v }); setPreview(null); }}>
                      <option value="">Choose employee…</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.id})</option>)}
                    </NativeSelect>
                  </div>
                  <Button variant="outline" className="gap-2" disabled={busy} onClick={doPreview}><Eye className="w-4 h-4" />Preview</Button>
                </div>
                {preview && (
                  <div className="space-y-3">
                    {preview.missing.length > 0 && (
                      <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>No data for: {preview.missing.map(m => `{{${m}}}`).join(', ')}. Update the employee record first, or generate with blanks.</span>
                      </div>
                    )}
                    <div className="border border-slate-200 rounded-lg bg-white p-4 sm:p-8 shadow-inner max-h-[60vh] overflow-y-auto">
                      <p className="font-bold text-slate-900">{preview.company_name}</p>
                      <hr className="my-3" />
                      {preview.title && <p className="text-center font-bold underline uppercase my-4">{preview.title}</p>}
                      <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{preview.body}</div>
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={generate} disabled={busy} className="gap-2 w-full sm:w-auto"><FileDown className="w-4 h-4" />{busy ? 'Generating…' : 'Generate PDF & save to vault'}</Button>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="templates">
            <SectionCard icon={FileSignature} title="Templates" actions={<Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing({ ...EMPTY })}><Plus className="w-3.5 h-3.5" />New template</Button>}>
              {templates.length === 0 ? <Empty icon={FileSignature} title="No templates" /> : (
                <div className="divide-y divide-slate-100">
                  {templates.map(t => (
                    <div key={t.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2"><p className="font-medium text-slate-900">{t.name}</p><Badge variant="outline" className="text-[10px] capitalize">{t.type}</Badge></div>
                        <p className="text-xs text-slate-500 truncate max-w-xl">{t.body.slice(0, 140)}…</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => setEditing({ ...t })}><Pencil className="w-3.5 h-3.5" />Edit</Button>
                        <Button variant="ghost" size="sm" className="h-8 text-red-600 hover:bg-red-50" aria-label="Delete template" onClick={() => deleteTemplate(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="issued">
            <SectionCard
              icon={Mail}
              title="Issued letters"
              actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={!issued.length} onClick={() => exportCsv('issued-letters', issued, [
                { key: 'employee_name', label: 'Employee' }, { key: 'employee_uid', label: 'Employee ID' }, { key: 'title', label: 'Letter' },
                { key: 'letter_reference', label: 'Reference' }, { key: 'issued_on', label: 'Issued on' }, { key: 'uploaded_by', label: 'Issued by' },
              ])}><Download className="w-3.5 h-3.5" />Export CSV</Button>}
            >
              {issued.length === 0 ? <Empty icon={Mail} title="No letters issued yet" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Letter</th>
                        <th className="text-left font-medium px-4 py-3">Employee</th>
                        <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Issued</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {issued.map(d => (
                        <tr key={d.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3"><p className="font-medium text-slate-900">{d.title}</p><p className="text-[11px] text-slate-500">{d.letter_reference}</p></td>
                          <td className="px-4 py-3">{d.employee_name}</td>
                          <td className="px-4 py-3 hidden sm:table-cell whitespace-nowrap">{fmtDate(d.issued_on || d.created_at)}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Download" onClick={() => downloadFile(`${API}/documents/${d.id}/download`, d.file_name).catch(() => toast.error('Download failed'))}><Download className="w-4 h-4" /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          {editing && (
            <>
              <DialogHeader><DialogTitle>{editing.id ? 'Edit letter template' : 'New letter template'}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label htmlFor="lt-name">Name</Label>
                    <Input id="lt-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <NativeSelect value={editing.type} onChange={(v) => setEditing({ ...editing, type: v })}>
                      {TYPES.map(t => <option key={t} value={t}>{humanize(t)}</option>)}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lt-title">Heading on the letter</Label>
                    <Input id="lt-title" value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Placeholders — click to insert</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {placeholders.map(p => (
                      <button key={p.key} type="button" title={p.label} onClick={() => insertPlaceholder(p.key)} className="text-[11px] font-mono px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
                        {`{{${p.key}}}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lt-body">Body <span className="text-slate-400 font-normal">(blank line = new paragraph)</span></Label>
                  <Textarea id="lt-body" ref={bodyRef} rows={14} className="font-mono text-xs sm:text-sm" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
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

export default LettersPage;
