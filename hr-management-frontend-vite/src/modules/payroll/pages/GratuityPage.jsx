import React, { useEffect, useState } from 'react';
import { Calculator, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { PageShell, SectionCard, EmptyBlock } from '../components/PayrollUI';
import { API, errMsg, fmtINR } from '../lib';

const today = () => new Date().toISOString().slice(0, 10);

export default function GratuityPage() {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_uid: 'manual', basic_monthly: '', joining_date: '', exit_date: today() });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`${API}/employees`, { params: { include_exited: 'true' } })
      .then(r => setEmployees(r.data || []))
      .catch(() => toast.error('Could not load employees'));
  }, []);

  const pickEmployee = (uid) => {
    const emp = employees.find(e => e.uid === uid);
    setForm(f => ({
      ...f,
      employee_uid: uid,
      basic_monthly: '',
      joining_date: emp?.joining_date ? String(emp.joining_date).slice(0, 10) : '',
      exit_date: emp?.exit_date ? String(emp.exit_date).slice(0, 10) : today(),
    }));
    setResult(null);
  };

  const calculate = async () => {
    const manual = form.employee_uid === 'manual';
    if (manual && !(Number(form.basic_monthly) >= 0 && form.basic_monthly !== '')) return toast.error('Enter the last drawn basic');
    if (!form.joining_date && manual) return toast.error('Enter the joining date');
    setBusy(true);
    try {
      const body = {
        ...(manual ? {} : { employee_uid: form.employee_uid }),
        ...(form.basic_monthly !== '' ? { basic_monthly: Number(form.basic_monthly) } : {}),
        ...(form.joining_date ? { joining_date: form.joining_date } : {}),
        exit_date: form.exit_date || null,
      };
      const res = await api.post(`${API}/gratuity/calculate`, body);
      setResult(res.data);
    } catch (e) {
      toast.error(errMsg(e, 'Could not calculate'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell icon={Calculator} title="Gratuity Calculator" subtitle="15/26 × last drawn basic (+DA) × completed years · eligible after 5 years · capped at ₹20 lakh">
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
        <SectionCard icon={Calculator} title="Inputs" bodyClassName="p-4 sm:p-5 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Employee</Label>
            <Select value={form.employee_uid} onValueChange={pickEmployee}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Enter figures manually</SelectItem>
                {employees.map(e => <SelectItem key={e.uid} value={e.uid}>{e.name} ({e.employee_code}){e.employment_status === 'exited' ? ' — exited' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Last drawn monthly basic + DA (₹){form.employee_uid !== 'manual' && <span className="text-slate-400"> — blank = from salary structure</span>}</Label>
            <Input type="number" min="0" value={form.basic_monthly} onChange={(e) => setForm({ ...form, basic_monthly: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Joining date</Label><Input type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Exit / as-on date</Label><Input type="date" value={form.exit_date} onChange={(e) => setForm({ ...form, exit_date: e.target.value })} /></div>
          </div>
          <Button onClick={calculate} disabled={busy} className="w-full bg-slate-800 hover:bg-slate-900">{busy ? 'Calculating…' : 'Calculate'}</Button>
        </SectionCard>

        <SectionCard icon={result?.eligible ? CheckCircle2 : XCircle} title="Result" bodyClassName="p-4 sm:p-5">
          {!result ? (
            <EmptyBlock icon={Calculator} title="Enter details and calculate" />
          ) : (
            <div className="space-y-3">
              <div className={`rounded-xl p-4 ${result.eligible ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                <p className="text-xs uppercase tracking-wider text-slate-500">Gratuity payable</p>
                <p className="text-2xl sm:text-3xl font-bold text-slate-900">{fmtINR(result.amount)}</p>
                {!result.eligible && <p className="text-sm text-amber-700 mt-1">{result.reason}</p>}
                {result.capped && <p className="text-sm text-slate-600 mt-1">Capped at the statutory maximum of ₹20,00,000.</p>}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Employee</dt><dd className="font-medium">{result.employee?.name || '—'}</dd>
                <dt className="text-slate-500">Service</dt><dd className="font-medium">{result.service.years}y {result.service.months}m {result.service.days}d</dd>
                <dt className="text-slate-500">Years counted</dt><dd className="font-medium">{result.years} {result.service.months >= 6 ? '(6+ months rounded up)' : ''}</dd>
                <dt className="text-slate-500">Basic + DA</dt><dd className="font-medium">{fmtINR(result.basic_monthly)}</dd>
                <dt className="text-slate-500">Period</dt><dd className="font-medium">{result.joining_date} → {result.exit_date}</dd>
              </dl>
              <p className="text-xs text-slate-500">Formula: 15 ÷ 26 × {fmtINR(result.basic_monthly)} × {result.years}</p>
            </div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}
