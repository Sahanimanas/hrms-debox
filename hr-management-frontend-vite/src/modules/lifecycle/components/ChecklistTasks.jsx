// Task list with done toggles + notes, used for onboarding and exit checklists.
import React, { useState } from 'react';
import { CheckCircle2, Circle, MessageSquare, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fmtDate, OWNER_LABELS, humanize, todayYmd } from '../lib';

const OWNER_STYLES = {
  hr: 'bg-purple-50 text-purple-700 border-purple-200',
  manager: 'bg-blue-50 text-blue-700 border-blue-200',
  employee: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  it: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

const ChecklistTasks = ({ tasks, canEdit, onUpdate, showCategory = false, showDue = true }) => {
  const [openNotes, setOpenNotes] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(null);
  const today = todayYmd();

  const toggle = async (task) => {
    setBusy(task.id);
    try {
      await onUpdate(task, { done: !task.done });
    } finally {
      setBusy(null);
    }
  };

  const saveNotes = async (task) => {
    setBusy(task.id);
    try {
      await onUpdate(task, { notes: draft });
      setOpenNotes(null);
    } finally {
      setBusy(null);
    }
  };

  if (!tasks?.length) return <p className="text-sm text-slate-500 p-4">No tasks.</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {tasks.map((task) => {
        const editable = canEdit(task);
        const overdue = showDue && !task.done && task.due_date && task.due_date < today;
        return (
          <li key={task.id} className="p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                disabled={!editable || busy === task.id}
                onClick={() => toggle(task)}
                className={`mt-0.5 shrink-0 ${editable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
                title={editable ? '' : 'Only the task owner can update this'}
              >
                {task.done
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  : <Circle className="w-5 h-5 text-slate-300 hover:text-slate-500" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className={`text-sm font-medium ${task.done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{task.title}</p>
                  <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${OWNER_STYLES[task.owner] || ''}`}>{OWNER_LABELS[task.owner] || task.owner}</Badge>
                  {showCategory && task.category && <Badge variant="outline" className="text-[10px] py-0 px-1.5">{humanize(task.category)}</Badge>}
                  {overdue && <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] py-0 px-1.5">Overdue</Badge>}
                </div>
                {task.description && <p className="text-xs text-slate-500 mt-0.5">{task.description}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                  {task.assignee_name && <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{task.assignee_name}</span>}
                  {showDue && task.due_date && <span>Due {fmtDate(task.due_date)}</span>}
                  {task.done && task.done_by_name && <span>Done by {task.done_by_name}{task.done_at ? ` · ${fmtDate(task.done_at)}` : ''}</span>}
                </div>
                {task.notes && openNotes !== task.id && (
                  <p className="text-xs text-slate-600 mt-1 bg-slate-50 rounded px-2 py-1 break-words">{task.notes}</p>
                )}
                {openNotes === task.id && (
                  <div className="mt-2 space-y-2">
                    <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note" />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" disabled={busy === task.id} onClick={() => saveNotes(task)}>Save</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpenNotes(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
              {editable && openNotes !== task.id && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Notes"
                  onClick={() => { setOpenNotes(task.id); setDraft(task.notes || ''); }}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default ChecklistTasks;
