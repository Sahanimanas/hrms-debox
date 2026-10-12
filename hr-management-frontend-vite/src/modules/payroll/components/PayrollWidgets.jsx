// Dashboard widgets for the payroll module.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Banknote, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { API, fmtINR, monthLabel } from '../lib';

export function LatestPayslipWidget() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/my/summary`).then(r => { if (alive) setData(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data?.latest_payslip) return null;
  const p = data.latest_payslip;
  const activeLoan = data.loans?.find(l => l.status === 'disbursed');
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Wallet className="w-5 h-5" /></div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">Payslip · {monthLabel(p.month, true)}</p>
            <p className="text-lg sm:text-xl font-bold text-slate-900">{fmtINR(p.net_pay)} <span className="text-xs font-normal text-slate-500">net pay</span></p>
            {activeLoan && <p className="text-xs text-slate-500">Loan outstanding {fmtINR(activeLoan.outstanding, 0)} · EMI {fmtINR(activeLoan.emi, 0)}</p>}
          </div>
        </div>
        <Link to="/my-payslips" className="text-sm font-medium text-slate-700 hover:text-slate-900 inline-flex items-center gap-1">
          View payslips <ArrowRight className="w-4 h-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function PayrollAdminWidget() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/dashboard`).then(r => { if (alive) setData(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const run = data.current_run;
  const items = [
    ['Pending loan requests', data.pending_loans, '/payroll/loans'],
    ['Declarations to verify', data.pending_declarations, '/payroll/declarations'],
    ['Missing bank details', data.missing_bank, '/payroll/statutory'],
  ];
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0"><Banknote className="w-5 h-5" /></div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Payroll · {monthLabel(data.month, true)}</p>
              <p className="text-base sm:text-lg font-bold text-slate-900">
                {run ? `${run.status[0].toUpperCase()}${run.status.slice(1)} · net ${fmtINR(run.totals?.net, 0)}` : 'Not started'}
              </p>
            </div>
          </div>
          <Link to={run ? `/payroll/runs/${run.id}` : '/payroll/runs'} className="text-sm font-medium text-slate-700 hover:text-slate-900 inline-flex items-center gap-1">
            {run ? 'Open run' : 'Run payroll'} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {items.map(([label, value, href]) => (
            <Link key={label} to={href} className="rounded-lg bg-slate-50 hover:bg-slate-100 p-2">
              <p className={`text-lg font-bold ${value ? 'text-amber-600' : 'text-slate-900'}`}>{value}</p>
              <p className="text-[10px] sm:text-xs text-slate-500 leading-tight">{label}</p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
