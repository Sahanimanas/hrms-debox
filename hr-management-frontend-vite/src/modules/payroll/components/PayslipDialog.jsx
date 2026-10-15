// Payslip breakdown dialog (admin run detail and My Payslips).
import React from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { fmtINR, monthLabel } from '../lib';

function Lines({ title, rows, total, tone }) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider ${tone}`}>{title}</div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">None</p>}
        {rows.map((r, i) => (
          <div key={`${r.name}-${i}`} className="flex justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="text-slate-700 min-w-0 break-words">{r.name}</span>
            <span className="font-medium text-slate-900 whitespace-nowrap">{fmtINR(r.amount)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between px-3 py-2 bg-slate-50 text-sm font-semibold">
        <span>Total</span>
        <span>{fmtINR(total)}</span>
      </div>
    </div>
  );
}

export default function PayslipDialog({ payslip, open, onOpenChange, onDownload, downloading }) {
  if (!payslip) return null;
  const ec = payslip.employer_contributions || {};
  const tax = payslip.tax || {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{payslip.employee_name} — {monthLabel(payslip.month, true)}</DialogTitle>
          <DialogDescription>
            {payslip.employee_code || payslip.employee_uid} · {payslip.department || 'No department'} · {payslip.tax_regime === 'old' ? 'Old' : 'New'} tax regime
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            ['Paid days', payslip.payable_days],
            ['LOP days', payslip.lop_days],
            ['Gross', fmtINR(payslip.gross_earnings, 0)],
            ['Net pay', fmtINR(payslip.net_pay, 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
              <p className="text-sm sm:text-base font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        {payslip.warnings?.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 space-y-0.5">
            {payslip.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}</p>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Lines title="Earnings" rows={payslip.earnings || []} total={payslip.gross_earnings} tone="bg-emerald-50 text-emerald-700" />
          <Lines title="Deductions" rows={payslip.deductions || []} total={payslip.total_deductions} tone="bg-rose-50 text-rose-700" />
        </div>

        <div className="rounded-lg bg-slate-900 text-white p-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-slate-300">Net pay</span>
          <span className="text-lg font-bold">{fmtINR(payslip.net_pay)}</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-xs text-slate-600">
          <div className="rounded-lg border border-slate-200 p-3 space-y-1">
            <p className="font-semibold text-slate-800 text-sm">Employer contributions</p>
            <p>PF: {fmtINR(ec.pf)} (EPS {fmtINR(ec.eps)}, EPF {fmtINR(ec.epf)})</p>
            <p>EDLI / admin: {fmtINR(ec.edli)} / {fmtINR(ec.pf_admin)}</p>
            <p>ESI: {fmtINR(ec.esi)} · LWF: {fmtINR(ec.lwf)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 space-y-1">
            <p className="font-semibold text-slate-800 text-sm">Income tax projection</p>
            <p>Projected taxable income: {fmtINR(tax.taxable_income, 0)}</p>
            <p>Annual tax: {fmtINR(tax.annual_tax, 0)} · TDS so far: {fmtINR(tax.tds_deducted_before, 0)}</p>
            <p>This month: {fmtINR(tax.monthly_tds, 0)} ({tax.remaining_months} month(s) left)</p>
          </div>
        </div>

        {onDownload && (
          <div className="flex justify-end">
            <Button onClick={onDownload} disabled={downloading} className="gap-2">
              <Download className="w-4 h-4" /> {downloading ? 'Preparing…' : 'Download PDF'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
