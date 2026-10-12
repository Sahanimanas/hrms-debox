import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Field, NativeSelect } from './FormBits';
import { API, STAGES, STAGE_LABELS, errorMessage } from '../lib';

const REJECT_REASONS = ['Skills mismatch', 'Not enough experience', 'Compensation mismatch', 'Culture fit concerns', 'Position filled', 'No response from candidate'];

/** Collects the (required) rejection reason or an optional note for withdrawals. */
export function StageReasonDialog({ pending, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (pending) setReason(''); }, [pending]);

  const submit = async () => {
    if (pending.stage === 'rejected' && reason.trim().length < 3) return toast.error('Please give a reason');
    setSaving(true);
    try {
      const res = await api.post(`${API}/candidates/${pending.candidate.id}/stage`, { stage: pending.stage, reason: reason.trim() });
      toast.success(`${pending.candidate.name} moved to ${STAGE_LABELS[pending.stage]}`);
      onDone?.(res.data);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not move the candidate'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending?.stage === 'rejected' ? 'Reject candidate' : 'Mark as withdrawn'}</DialogTitle>
          <DialogDescription>{pending?.candidate.name}{pending?.stage === 'rejected' ? ' — upcoming interviews will be cancelled.' : ''}</DialogDescription>
        </DialogHeader>
        {pending?.stage === 'rejected' && (
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={`text-xs px-2 py-1 rounded-full border ${reason === r ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                {r}
              </button>
            ))}
          </div>
        )}
        <Field id="sr-reason" label={pending?.stage === 'rejected' ? 'Reason *' : 'Note (optional)'} hint="Internal only — never shown to the candidate or referrer.">
          <Textarea id="sr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className={pending?.stage === 'rejected' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'}>
            {saving ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Stage dropdown (keyboard / mobile alternative to drag-and-drop). */
export function StageSelect({ candidate, onMove, className = '', id }) {
  const disabled = candidate.stage === 'hired';
  return (
    <NativeSelect
      id={id || `stage-${candidate.id}`}
      aria-label={`Stage for ${candidate.name}`}
      value={candidate.stage}
      disabled={disabled}
      onChange={(stage) => onMove(candidate, stage)}
      className={`h-8 text-xs ${className}`}
      options={STAGES.filter(s => s !== 'hired' || candidate.stage === 'hired').map(s => ({ value: s, label: STAGE_LABELS[s] }))}
    />
  );
}
