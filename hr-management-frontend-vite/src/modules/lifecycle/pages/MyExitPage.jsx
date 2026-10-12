import React, { useCallback, useEffect, useState } from 'react';
import { DoorOpen, Send, ListChecks, History, Undo2, CalendarClock, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { addDays, format } from 'date-fns';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { API, errMsg, fmtDate, todayYmd, SEPARATION_STATUS, downloadFile } from '../lib';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatusPill, ProgressBar } from '../components/ui';
import ChecklistTasks from '../components/ChecklistTasks';
import ExitInterviewForm from '../components/ExitInterviewForm';

const MyExitPage = () => {
  const { user } = getAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ reason: '', last_working_day: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/offboarding/my`);
      setData(r.data);
    } catch (e) {
      setError(errMsg(e, 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const noticeDays = data?.notice_period_days ?? 30;
  const noticeEnd = format(addDays(new Date(), noticeDays), 'yyyy-MM-dd');
  const current = data?.current;

  const submit = async () => {
    if (form.reason.trim().length < 3) return toast.error('Please tell us the reason');
    if (!window.confirm('Submit your resignation? Your manager and HR will be notified.')) return;
    setSubmitting(true);
    try {
      await api.post(`${API}/offboarding/resign`, {
        reason: form.reason.trim(),
        last_working_day: form.last_working_day || null,
        notes: form.notes.trim() || null,
      });
      toast.success('Resignation submitted');
      setForm({ reason: '', last_working_day: '', notes: '' });
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to submit'));
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm('Withdraw your resignation?')) return;
    try {
      await api.post(`${API}/offboarding/${current.id}/withdraw`, {});
      toast.success('Resignation withdrawn');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to withdraw'));
    }
  };

  const updateItem = async (item, body) => {
    try {
      await api.patch(`${API}/offboarding/${current.id}/checklist/${item.id}`, body);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to update'));
    }
  };

  const shortfall = form.last_working_day && form.last_working_day < noticeEnd
    ? Math.round((new Date(`${noticeEnd}T00:00:00`) - new Date(`${form.last_working_day}T00:00:00`)) / 86400000)
    : 0;

  const checklist = current?.checklist || [];
  const done = checklist.filter(i => i.done).length;

  return (
    <PageShell>
      <PageHeader icon={DoorOpen} title="Resignation" subtitle="Submit a resignation, track approval and complete your exit formalities" />

      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          {!current ? (
            <SectionCard icon={Send} title="Submit resignation">
              <div className="p-3 sm:p-5 space-y-4">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs sm:text-sm text-slate-600">
                  Your notice period is <span className="font-semibold text-slate-900">{noticeDays} days</span>, so your last working day would be
                  {' '}<span className="font-semibold text-slate-900">{fmtDate(noticeEnd)}</span>. You can propose an earlier date; unserved notice may be recovered in your full and final settlement.
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rs-reason">Reason for leaving</Label>
                  <Textarea id="rs-reason" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Pursuing a new opportunity" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rs-lwd">Proposed last working day</Label>
                    <Input id="rs-lwd" type="date" min={todayYmd()} value={form.last_working_day} onChange={(e) => setForm({ ...form, last_working_day: e.target.value })} />
                    <p className="text-[11px] text-slate-500">Leave blank to serve the full notice period</p>
                    {shortfall > 0 && <p className="text-[11px] text-amber-600">{shortfall} day(s) short of the notice period</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rs-notes">Notes for your manager (optional)</Label>
                    <Textarea id="rs-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={submit} disabled={submitting} className="bg-slate-800 hover:bg-slate-900 gap-2 w-full sm:w-auto">
                    <Send className="w-4 h-4" />{submitting ? 'Submitting…' : 'Submit resignation'}
                  </Button>
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard
              icon={CalendarClock}
              title={current.type === 'termination' ? 'Separation' : 'Your resignation'}
              actions={<StatusPill map={SEPARATION_STATUS} status={current.status} />}
            >
              <div className="p-3 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><p className="text-xs text-slate-500">Submitted</p><p className="font-medium">{fmtDate(current.submitted_on)}</p></div>
                <div><p className="text-xs text-slate-500">Notice period</p><p className="font-medium">{current.notice_period_days} days</p></div>
                <div><p className="text-xs text-slate-500">{current.last_working_day ? 'Last working day' : 'Requested last day'}</p><p className="font-medium">{fmtDate(current.last_working_day || current.requested_last_day)}</p></div>
                <div><p className="text-xs text-slate-500">Reason</p><p className="font-medium break-words">{current.reason}</p></div>
                {current.action_comments && (
                  <div className="col-span-2 sm:col-span-4 text-xs text-slate-600 italic">“{current.action_comments}” — {current.actioned_by_name}</div>
                )}
              </div>
              {current.status === 'pending' && current.type === 'resignation' && (
                <div className="px-3 sm:px-5 pb-4 flex justify-end">
                  <Button variant="outline" className="gap-2 text-red-600 hover:bg-red-50" onClick={withdraw}><Undo2 className="w-4 h-4" />Withdraw resignation</Button>
                </div>
              )}
              {current.status === 'completed' && current.settlement?.status === 'finalized' && (
                <div className="px-3 sm:px-5 pb-4 flex justify-end">
                  <Button variant="outline" className="gap-2" onClick={() => downloadFile(`${API}/offboarding/${current.id}/settlement/pdf`, 'full-and-final-settlement.pdf').catch(() => toast.error('Download failed'))}>
                    <FileDown className="w-4 h-4" />Settlement statement
                  </Button>
                </div>
              )}
            </SectionCard>
          )}

          {current?.status === 'approved' && (
            <>
              <SectionCard icon={ListChecks} title="Exit checklist" actions={<span className="text-xs text-slate-500">{done}/{checklist.length} done</span>}>
                <div className="px-3 sm:px-5 pt-3"><ProgressBar value={checklist.length ? (done / checklist.length) * 100 : 0} /></div>
                <ChecklistTasks
                  tasks={checklist}
                  showCategory
                  showDue={false}
                  canEdit={(i) => i.owner === 'employee' || i.assignee_email === user?.email}
                  onUpdate={updateItem}
                />
              </SectionCard>
              <ExitInterviewForm />
            </>
          )}

          {data?.history?.length > 0 && (
            <SectionCard icon={History} title="History">
              {data.history.length === 0 ? <Empty title="No history" /> : (
                <div className="divide-y divide-slate-100">
                  {data.history.map(s => (
                    <div key={s.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 capitalize">{s.type} · {fmtDate(s.submitted_on)}</p>
                        <p className="text-xs text-slate-500 break-words">{s.reason}</p>
                      </div>
                      <StatusPill map={SEPARATION_STATUS} status={s.status} />
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </PageShell>
  );
};

export default MyExitPage;
