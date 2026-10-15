import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Hourglass, Download, Search, CheckCircle2, CalendarPlus, AlertTriangle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, fmtDate, todayYmd } from '../lib';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatTile, NativeSelect, Avatar } from '../components/ui';

const DaysLeft = ({ row }) => {
  if (row.days_left == null) return <span className="text-slate-400">—</span>;
  if (row.days_left < 0) return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px]">Overdue {Math.abs(row.days_left)}d</Badge>;
  if (row.days_left === 0) return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px]">Ends today</Badge>;
  if (row.days_left <= 7) return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">{row.days_left} days</Badge>;
  return <span className="text-xs text-slate-600">{row.days_left} days</span>;
};

const ProbationPage = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [window_, setWindow] = useState('all');
  const [action, setAction] = useState(null); // { kind, row, date, notes, reason }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/probation`);
      setRows(r.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load probation list'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (window_ === 'overdue' && !(r.days_left != null && r.days_left < 0)) return false;
      if (window_ === '30' && !(r.days_left != null && r.days_left <= 30)) return false;
      return !q || r.full_name.toLowerCase().includes(q) || (r.department || '').toLowerCase().includes(q);
    });
  }, [rows, search, window_]);

  const submit = async () => {
    const { kind, row } = action;
    setBusy(true);
    try {
      if (kind === 'confirm') {
        await api.post(`${API}/probation/${row.uid}/confirm`, { confirmation_date: action.date || null, notes: action.notes || null });
        toast.success(`${row.full_name} confirmed`);
      } else {
        if (!action.date || (action.reason || '').trim().length < 3) { setBusy(false); return toast.error('New end date and a reason are required'); }
        await api.post(`${API}/probation/${row.uid}/extend`, { new_end_date: action.date, reason: action.reason });
        toast.success('Probation extended');
      }
      setAction(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const doExport = () => exportCsv('probation', filtered, [
    { key: 'full_name', label: 'Employee' },
    { key: 'employee_id', label: 'Employee ID' },
    { key: 'department', label: 'Department' },
    { key: 'designation', label: 'Designation' },
    { label: 'Joined', value: r => (r.joining_date ? String(r.joining_date).slice(0, 10) : '') },
    { key: 'probation_end_date', label: 'Probation ends' },
    { key: 'days_left', label: 'Days left' },
    { label: 'Extensions', value: r => r.extensions.length },
  ]);

  return (
    <PageShell>
      <PageHeader icon={Hourglass} title="Probation" subtitle="Confirm or extend employees on probation" />
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="On probation" value={rows.length} icon={Users} onClick={() => setWindow('all')} />
        <StatTile label="Ending in 30 days" value={rows.filter(r => r.days_left != null && r.days_left >= 0 && r.days_left <= 30).length} icon={Hourglass} tone="amber" onClick={() => setWindow('30')} />
        <StatTile label="Overdue review" value={rows.filter(r => r.days_left != null && r.days_left < 0).length} icon={AlertTriangle} tone="rose" onClick={() => setWindow('overdue')} />
      </div>
      <SectionCard
        icon={Hourglass}
        title="Employees on probation"
        actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={doExport} disabled={!filtered.length}><Download className="w-3.5 h-3.5" />Export CSV</Button>}
      >
        <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search employee or department" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect value={window_} onChange={setWindow} className="sm:w-48">
            <option value="all">All</option>
            <option value="30">Ending within 30 days</option>
            <option value="overdue">Overdue</option>
          </NativeSelect>
        </div>
        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : filtered.length === 0 ? (
          <Empty icon={Hourglass} title="No one on probation here" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Employee</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Joined</th>
                  <th className="text-left font-medium px-4 py-3">Ends</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Left</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(r => (
                  <tr key={r.uid} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={r.full_name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{r.full_name}</p>
                          <p className="text-xs text-slate-500 truncate">{r.designation || '—'} · {r.department || '—'}</p>
                          {r.extensions.length > 0 && <p className="text-[11px] text-amber-700">Extended {r.extensions.length}×</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap">{fmtDate(r.joining_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(r.probation_end_date)}<div className="sm:hidden mt-0.5"><DaysLeft row={r} /></div></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><DaysLeft row={r} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setAction({ kind: 'confirm', row: r, date: todayYmd(), notes: '' })}><CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Confirm</span></Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setAction({ kind: 'extend', row: r, date: '', reason: '' })}><CalendarPlus className="w-3.5 h-3.5" /><span className="hidden sm:inline">Extend</span></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          {action && (
            <>
              <DialogHeader><DialogTitle>{action.kind === 'confirm' ? `Confirm ${action.row.full_name}` : `Extend probation — ${action.row.full_name}`}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Current end date: {fmtDate(action.row.probation_end_date)}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="pb-date">{action.kind === 'confirm' ? 'Confirmation date' : 'New end date'}</Label>
                  <Input id="pb-date" type="date" value={action.date} min={action.kind === 'extend' ? action.row.probation_end_date : undefined} onChange={(e) => setAction({ ...action, date: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pb-notes">{action.kind === 'confirm' ? 'Notes (optional)' : 'Reason'}</Label>
                  <Textarea id="pb-notes" rows={3} value={action.kind === 'confirm' ? action.notes : action.reason} onChange={(e) => setAction({ ...action, [action.kind === 'confirm' ? 'notes' : 'reason']: e.target.value })} />
                </div>
                <p className="text-xs text-slate-500">The employee is notified and the change is recorded in their job history.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
                <Button onClick={submit} disabled={busy} className={action.kind === 'confirm' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}>
                  {busy ? 'Saving…' : action.kind === 'confirm' ? 'Confirm employee' : 'Extend probation'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default ProbationPage;
