import React from 'react';
import { CheckCircle2, Clock, Circle, XCircle, MinusCircle, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

const STEP_STYLES = {
  approved: { icon: CheckCircle2, cls: 'text-emerald-600', ring: 'border-emerald-200 bg-emerald-50' },
  rejected: { icon: XCircle, cls: 'text-red-600', ring: 'border-red-200 bg-red-50' },
  skipped: { icon: MinusCircle, cls: 'text-slate-400', ring: 'border-slate-200 bg-slate-50' },
  cancelled: { icon: MinusCircle, cls: 'text-slate-400', ring: 'border-slate-200 bg-slate-50' },
  current: { icon: Clock, cls: 'text-amber-600', ring: 'border-amber-300 bg-amber-50' },
  waiting: { icon: Circle, cls: 'text-slate-300', ring: 'border-slate-200 bg-white' },
};

const approverLabel = (step) => {
  if (step.approver_type === 'admin') return 'Any HR / admin';
  return step.approver_name || step.approver_email || 'Reporting manager';
};

/**
 * Multi-level approval status for a leave (LV-4).
 * `chain` is leave.approval_chain from the API. Skipped levels (no reporting
 * manager, approver is the applicant …) are left out — the leave goes straight
 * to the next approver — unless `showSkipped` is set.
 */
const ApprovalChain = ({ chain: fullChain, compact = false, showSkipped = false }) => {
  if (!Array.isArray(fullChain) || fullChain.length === 0) return null;
  const visible = showSkipped ? fullChain : fullChain.filter((s) => s.status !== 'skipped');
  const chain = visible.length ? visible : fullChain;
  const currentLevel = chain.find((s) => s.status === 'pending')?.level;

  return (
    <div className="flex flex-wrap items-stretch gap-1.5" aria-label="Approval chain">
      {chain.map((step, idx) => {
        const state = step.status === 'pending' ? (step.level === currentLevel ? 'current' : 'waiting') : step.status;
        const style = STEP_STYLES[state] || STEP_STYLES.waiting;
        const Icon = style.icon;
        return (
          <React.Fragment key={`${step.level}-${idx}`}>
            {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 self-center shrink-0" />}
            <div className={`rounded-lg border px-2 py-1 min-w-0 ${style.ring}`} title={step.comments || undefined}>
              <div className="flex items-center gap-1.5">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${style.cls}`} />
                <span className="text-[11px] sm:text-xs font-medium text-slate-800 truncate">{step.name}</span>
              </div>
              {!compact && (
                <div className="text-[10px] sm:text-[11px] text-slate-500 leading-tight mt-0.5">
                  {step.status === 'approved' || step.status === 'rejected' ? (
                    <>
                      {step.status === 'approved' ? 'Approved' : 'Rejected'} by {step.acted_by_name || step.acted_by_email}
                      {step.on_behalf_of_name || step.on_behalf_of_email ? ` for ${step.on_behalf_of_name || step.on_behalf_of_email}` : ''}
                      {step.acted_at ? ` · ${format(new Date(step.acted_at), 'dd MMM')}` : ''}
                    </>
                  ) : step.status === 'skipped' ? (
                    step.comments || 'Skipped'
                  ) : step.status === 'cancelled' ? (
                    'Not needed'
                  ) : (
                    <>Awaiting {approverLabel(step)}</>
                  )}
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default ApprovalChain;
