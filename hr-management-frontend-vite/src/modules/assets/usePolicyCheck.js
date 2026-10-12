import { useEffect, useState } from 'react';
import api from '@/lib/api';

/**
 * Debounced pre-submit expense-policy check for a claim form.
 * Returns { check, loading } — check is null until category and amount are filled.
 */
export default function usePolicyCheck({ category, amount, expenseDate, hasReceipt, reimbursementId, enabled = true }) {
  const [state, setState] = useState({ check: null, loading: false, key: '' });
  const value = parseFloat(amount);
  const ready = enabled && !!category && Number.isFinite(value) && value > 0;
  const key = ready ? JSON.stringify([category, value, expenseDate || '', !!hasReceipt, reimbursementId || '']) : '';

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setState(s => ({ ...s, loading: true }));
      try {
        const { data } = await api.post('/v2/assets/expense-policies/check', {
          category,
          amount: value,
          expense_date: expenseDate || null,
          has_receipt: !!hasReceipt,
          reimbursement_id: reimbursementId || null,
        });
        if (!cancelled) setState({ check: data, loading: false, key });
      } catch {
        if (!cancelled) setState({ check: null, loading: false, key });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, category, value, expenseDate, hasReceipt, reimbursementId]);

  if (!key) return { check: null, loading: false };
  return { check: state.key === key ? state.check : null, loading: state.loading || state.key !== key };
}
