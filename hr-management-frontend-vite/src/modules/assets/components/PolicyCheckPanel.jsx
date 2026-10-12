import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { inr } from '../lib';

/**
 * Shows the result of an expense-policy check (from /v2/assets/expense-policies/check
 * or a claim's stored policy_check). `compact` renders a one-line badge-style summary.
 */
export default function PolicyCheckPanel({ check, loading, compact = false }) {
  if (loading) {
    return <p className="text-xs text-slate-500">Checking expense policy…</p>;
  }
  if (!check) return null;

  const policy = check.policy || check;
  const hasPolicy = check.has_policy ?? !!check.category;
  const status = check.status;

  if (compact) {
    if (status === 'ok' || !status) return null;
    const blocked = status === 'blocked';
    return (
      <div className={`mt-2 p-2 rounded-lg border text-xs ${blocked ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        <p className="font-semibold flex items-center gap-1">
          {blocked ? <ShieldX className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
          {blocked ? 'Outside expense policy' : 'Policy exception — review carefully'}
        </p>
        <ul className="list-disc ml-5 mt-1 space-y-0.5">
          {(check.violations || []).map(v => <li key={v.code}>{v.message}</li>)}
        </ul>
      </div>
    );
  }

  if (!hasPolicy) {
    return (
      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
        No expense policy applies to this category.
      </div>
    );
  }

  const tone = status === 'blocked'
    ? { box: 'bg-red-50 border-red-200', text: 'text-red-700', Icon: ShieldX, title: 'This claim breaks a hard policy limit and cannot be submitted' }
    : status === 'warning'
      ? { box: 'bg-amber-50 border-amber-200', text: 'text-amber-800', Icon: ShieldAlert, title: 'You can submit, but this claim will be flagged for the approver' }
      : { box: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', Icon: ShieldCheck, title: 'Within expense policy' };
  const Icon = tone.Icon;

  const limits = [
    policy.max_per_claim != null && `Max ${inr(policy.max_per_claim)} per claim`,
    policy.monthly_cap != null && `Monthly cap ${inr(policy.monthly_cap)}${check.monthly_remaining != null ? ` (${inr(check.monthly_remaining)} left)` : ''}`,
    policy.receipt_required_above != null && (policy.receipt_required_above > 0 ? `Receipt above ${inr(policy.receipt_required_above)}` : 'Receipt always required'),
  ].filter(Boolean);

  return (
    <div className={`p-2.5 sm:p-3 rounded-lg border ${tone.box}`}>
      <p className={`text-xs sm:text-sm font-semibold flex items-center gap-1.5 ${tone.text}`}>
        <Icon className="w-4 h-4 shrink-0" /> {tone.title}
      </p>
      {check.violations?.length > 0 && (
        <ul className={`list-disc ml-6 mt-1 text-xs space-y-0.5 ${tone.text}`}>
          {check.violations.map(v => <li key={v.code}>{v.message}</li>)}
        </ul>
      )}
      {limits.length > 0 && (
        <p className="text-[11px] text-slate-600 mt-1.5">
          {policy.category} policy ({policy.enforcement === 'hard' ? 'hard limit' : 'soft limit'}): {limits.join(' · ')}
        </p>
      )}
    </div>
  );
}
