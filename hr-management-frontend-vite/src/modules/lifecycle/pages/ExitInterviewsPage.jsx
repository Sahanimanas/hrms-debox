import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Download, Star, BarChart3, Plus, Trash2, ArrowUp, ArrowDown, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate } from '../lib';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatTile, NativeSelect, Avatar } from '../components/ui';

const ExitInterviewsPage = () => {
  const [summary, setSummary] = useState(null);
  const [responses, setResponses] = useState([]);
  const [questions, setQuestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, t] = await Promise.all([
        api.get(`${API}/exit-interviews/summary`),
        api.get(`${API}/exit-interviews`),
        api.get(`${API}/exit-interview/template`),
      ]);
      setSummary(s.data);
      setResponses(r.data || []);
      setQuestions(t.data.questions);
    } catch (e) {
      setError(errMsg(e, 'Failed to load exit interviews'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveQuestions = async () => {
    if (questions.some(q => q.text.trim().length < 3)) return toast.error('Every question needs text');
    if (questions.some(q => q.type === 'choice' && (q.options || []).filter(Boolean).length < 2)) return toast.error('Choice questions need at least two options');
    try {
      const r = await api.put(`${API}/exit-interview/template`, {
        questions: questions.map(q => ({ ...q, options: q.type === 'choice' ? q.options.filter(Boolean) : undefined })),
      });
      setQuestions(r.data.questions);
      toast.success('Questionnaire saved');
    } catch (e) {
      toast.error(errMsg(e, 'Failed to save'));
    }
  };

  const setQ = (i, patch) => setQuestions(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const move = (i, d) => {
    const next = [...questions];
    const [q] = next.splice(i, 1);
    next.splice(i + d, 0, q);
    setQuestions(next);
  };

  const doExport = () => exportCsv('exit-interviews', responses, [
    { key: 'employee_name', label: 'Employee' },
    { key: 'department', label: 'Department' },
    { key: 'separation_type', label: 'Type' },
    { key: 'last_working_day', label: 'Last working day' },
    { key: 'primary_reason', label: 'Reason for leaving' },
    { key: 'average_rating', label: 'Average rating' },
    { label: 'Submitted', value: r => fmtDate(r.submitted_at) },
    ...((questions || []).map(q => ({
      label: q.text,
      value: (r) => {
        const a = r.answers.find(x => x.question_id === q.id);
        return a ? (a.rating ?? a.choice ?? a.text ?? '') : '';
      },
    }))),
  ]);

  return (
    <PageShell>
      <PageHeader icon={MessageSquareText} title="Exit Interviews" subtitle="Why people leave, and what they tell us on the way out" />
      {loading && !summary ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="responses">Responses</TabsTrigger>
            <TabsTrigger value="questions">Questionnaire</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <StatTile label="Responses" value={summary.responses} icon={Users} />
              <StatTile label="Average rating" value={summary.overall_average != null ? `${summary.overall_average} / 5` : '—'} icon={Star} tone="amber" />
            </div>
            {summary.responses === 0 ? (
              <SectionCard icon={BarChart3} title="Insights"><Empty icon={BarChart3} title="No exit interviews yet" hint="Employees serving notice can fill the questionnaire from their Resignation page." /></SectionCard>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SectionCard icon={Star} title="Average rating by question">
                  <div className="p-3 sm:p-4" style={{ height: Math.max(220, summary.ratings.length * 46) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={summary.ratings.map(r => ({ name: r.text.length > 38 ? `${r.text.slice(0, 36)}…` : r.text, average: r.average }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="average" fill="#1e293b" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
                <SectionCard icon={BarChart3} title="Reasons for leaving">
                  <div className="p-3 sm:p-5 space-y-3">
                    {summary.reasons.map(r => {
                      const pct = Math.round((r.count / summary.responses) * 100);
                      return (
                        <div key={r.reason}>
                          <div className="flex justify-between text-sm mb-1"><span className="text-slate-700">{r.reason}</span><span className="font-medium text-slate-900">{r.count} · {pct}%</span></div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              </div>
            )}
          </TabsContent>

          <TabsContent value="responses">
            <SectionCard icon={Users} title="Responses" actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={doExport} disabled={!responses.length}><Download className="w-3.5 h-3.5" />Export CSV</Button>}>
              {responses.length === 0 ? <Empty icon={Users} title="No responses yet" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Employee</th>
                        <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Reason</th>
                        <th className="text-left font-medium px-4 py-3">Rating</th>
                        <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {responses.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setViewing(r)}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Avatar name={r.employee_name} size="sm" />
                              <div className="min-w-0"><p className="font-medium text-slate-900 truncate">{r.employee_name}</p><p className="text-xs text-slate-500 truncate">{r.department || '—'}</p></div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">{r.primary_reason || '—'}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{r.average_rating != null ? <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />{r.average_rating}</span> : '—'}</td>
                          <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap">{fmtDate(r.submitted_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="questions">
            <SectionCard icon={MessageSquareText} title="Questionnaire" actions={<Button size="sm" className="h-8 bg-slate-800 hover:bg-slate-900" onClick={saveQuestions}>Save</Button>}>
              {!questions ? <Loading /> : (
                <div className="p-3 sm:p-5 space-y-3">
                  <p className="text-xs text-slate-500">Changes apply to future responses. Mark one choice question as the “reason for leaving” to drive the breakdown chart.</p>
                  {questions.map((q, i) => (
                    <div key={q.id || i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex gap-2">
                        <Input value={q.text} placeholder="Question" onChange={(e) => setQ(i, { text: e.target.value })} />
                        <div className="flex shrink-0">
                          <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" aria-label="Remove question" className="text-red-600" disabled={questions.length === 1} onClick={() => setQuestions(questions.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <NativeSelect value={q.type} onChange={(v) => setQ(i, { type: v, options: v === 'choice' ? (q.options?.length ? q.options : ['', '']) : undefined, is_reason: v === 'choice' ? q.is_reason : false })} className="w-36">
                          <option value="rating">Rating (1–5)</option>
                          <option value="choice">Multiple choice</option>
                          <option value="text">Free text</option>
                        </NativeSelect>
                        <div className="flex items-center gap-2"><Switch id={`req-${i}`} checked={!!q.required} onCheckedChange={(v) => setQ(i, { required: v })} /><Label htmlFor={`req-${i}`} className="text-xs">Required</Label></div>
                        {q.type === 'choice' && (
                          <div className="flex items-center gap-2"><Switch id={`rsn-${i}`} checked={!!q.is_reason} onCheckedChange={(v) => setQuestions(questions.map((x, idx) => ({ ...x, is_reason: idx === i ? v : (v ? false : x.is_reason) })))} /><Label htmlFor={`rsn-${i}`} className="text-xs">Reason for leaving</Label></div>
                        )}
                      </div>
                      {q.type === 'choice' && (
                        <Input
                          value={(q.options || []).join(', ')}
                          placeholder="Options, comma separated"
                          onChange={(e) => setQ(i, { options: e.target.value.split(',').map(s => s.trimStart()) })}
                          onBlur={(e) => setQ(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        />
                      )}
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setQuestions([...questions, { type: 'rating', text: '', required: false }])}><Plus className="w-3.5 h-3.5" />Add question</Button>
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.employee_name}</DialogTitle>
                <p className="text-xs text-slate-500">{viewing.department || '—'} · last day {fmtDate(viewing.last_working_day)} · submitted {fmtDate(viewing.submitted_at)}</p>
              </DialogHeader>
              <div className="space-y-3">
                {viewing.answers.map(a => (
                  <div key={a.question_id} className="border-b border-slate-100 pb-2">
                    <p className="text-xs text-slate-500">{a.question_text}</p>
                    {a.type === 'rating' ? (
                      a.rating ? <div className="flex gap-0.5 mt-1">{[1, 2, 3, 4, 5].map(n => <Star key={n} className={`w-4 h-4 ${a.rating >= n ? 'fill-yellow-400 text-yellow-400' : 'text-slate-200'}`} />)}</div> : <p className="text-sm text-slate-400">—</p>
                    ) : <p className="text-sm text-slate-900 whitespace-pre-wrap break-words">{a.choice || a.text || '—'}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default ExitInterviewsPage;
