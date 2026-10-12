import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, Pin, PinOff, Trash2, Eye, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import Markdown from '@/modules/engagement/components/Markdown';
import { API, errorText, fromNow } from '../../lib';
import { Empty, Loading } from '../../components/Shared';

/** Lightweight project wiki: specs, meeting notes, runbooks (markdown subset). */
export default function DocsTab({ project, editable }) {
  const me = getAuth().user;
  const [docs, setDocs] = useState(null);
  const [current, setCurrent] = useState(null);
  const [draft, setDraft] = useState(null); // { title, body } while editing
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await api.get(`${API}/projects/${project.id}/docs`);
      setDocs(r.data);
      return r.data;
    } catch (err) {
      toast.error(errorText(err, 'Failed to load docs'));
      setDocs([]);
      return [];
    }
  }, [project.id]);

  const openDoc = async (id) => {
    try {
      const r = await api.get(`${API}/docs/${id}`);
      setCurrent(r.data);
      setDraft(null);
    } catch (err) {
      toast.error(errorText(err, 'Failed to open doc'));
    }
  };

  useEffect(() => {
    loadList().then(list => { if (list[0]) openDoc(list[0].id); });
  }, [loadList]);

  const create = async () => {
    try {
      const r = await api.post(`${API}/projects/${project.id}/docs`, { title: 'Untitled', body: '' });
      await loadList();
      setCurrent(r.data);
      setDraft({ title: r.data.title, body: '' });
    } catch (err) {
      toast.error(errorText(err, 'Failed to create doc'));
    }
  };

  const save = async (patch = draft) => {
    setSaving(true);
    try {
      const r = await api.put(`${API}/docs/${current.id}`, patch);
      setCurrent(c => ({ ...c, ...r.data }));
      if (patch === draft) setDraft(null);
      loadList();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`${API}/docs/${current.id}`);
      setCurrent(null);
      const list = await loadList();
      if (list[0]) openDoc(list[0].id);
    } catch (err) {
      toast.error(errorText(err, 'Failed to delete'));
    }
  };

  if (!docs) return <Loading />;

  return (
    <div className="grid md:grid-cols-[240px_1fr] gap-4">
      <div className="space-y-2">
        {editable && <Button size="sm" className="w-full gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={create}><Plus className="w-4 h-4" /> New doc</Button>}
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
          {docs.length === 0 && <p className="text-xs text-slate-400 p-3">No docs yet</p>}
          {docs.map(d => (
            <button key={d.id} type="button" onClick={() => openDoc(d.id)} className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${current?.id === d.id ? 'bg-slate-100' : ''}`}>
              <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">{d.pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0" />}{d.title}</p>
              <p className="text-[11px] text-slate-400 truncate">{d.updated_by_name} · {fromNow(d.updated_at)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white min-h-[420px]">
        {!current ? <Empty icon={FileText} title="Project docs">Keep specs, decisions, meeting notes and runbooks next to the work.</Empty> : (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
              {draft ? (
                <Input value={draft.title} onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))} className="h-9 font-semibold" />
              ) : (
                <h2 className="text-lg font-semibold text-slate-900 truncate flex-1" style={{ fontFamily: 'Plus Jakarta Sans' }}>{current.title}</h2>
              )}
              {editable && (
                <div className="flex gap-1 shrink-0 ml-auto">
                  {draft ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                      <Button size="sm" className="gap-1 bg-slate-800 hover:bg-slate-900" disabled={saving || !draft.title.trim()} onClick={() => save()}><Save className="w-3.5 h-3.5" /> Save</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" className="h-8 px-2" title={current.pinned ? 'Unpin' : 'Pin'} onClick={() => save({ pinned: !current.pinned })}>{current.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}</Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDraft({ title: current.title, body: current.body || '' })}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                      {(current.created_by === me?.email || current.my_role === 'admin') && <Button size="sm" variant="ghost" className="h-8 px-2 text-red-600 hover:bg-red-50" onClick={remove}><Trash2 className="w-4 h-4" /></Button>}
                    </>
                  )}
                </div>
              )}
            </div>
            {draft ? (
              <div className="grid lg:grid-cols-2 flex-1 min-h-[380px]">
                <Textarea value={draft.body} onChange={(e) => setDraft(d => ({ ...d, body: e.target.value }))} className="rounded-none border-0 border-r border-slate-100 resize-none min-h-[380px] font-mono text-sm focus-visible:ring-0" placeholder={'Write here…\n\n**bold**, *italic*, - bullet lists, [links](https://example.com)'} autoFocus />
                <div className="p-4 text-sm text-slate-700 overflow-y-auto hidden lg:block"><p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Eye className="w-3 h-3" /> Preview</p><Markdown text={draft.body} /></div>
              </div>
            ) : (
              <div className="p-4 sm:p-6 text-sm text-slate-700 flex-1">
                {current.body ? <Markdown text={current.body} /> : <p className="text-slate-400">This doc is empty.</p>}
                <p className="text-[11px] text-slate-400 mt-6">Created by {current.created_by_name} · last edited by {current.updated_by_name} {fromNow(current.updated_at)}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
