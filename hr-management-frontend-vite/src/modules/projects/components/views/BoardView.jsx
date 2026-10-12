import React, { useMemo, useState } from 'react';
import { Plus, MessageSquare, ListChecks, GitBranch, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { API, errorText, positionBetween, isOverdue } from '../../lib';
import { Avatar, PriorityIcon, TypeIcon, LabelChips, DueDate } from '../Shared';

function TaskCard({ task, project, onOpen, draggable, onDragStart, onDragEnd, dragging }) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}
      data-testid={`board-card-${task.key}`}
      className={`group rounded-lg bg-white border p-2.5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer select-none ${dragging ? 'opacity-40' : ''} ${isOverdue(task) ? 'border-red-200' : 'border-slate-200'}`}
    >
      <p className={`text-sm leading-snug ${task.status_category === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{task.title}</p>
      {task.label_ids?.length > 0 && <div className="mt-1.5"><LabelChips ids={task.label_ids} labels={project.labels} /></div>}
      <div className="flex items-center gap-2 mt-2 text-slate-400">
        <TypeIcon type={task.type} />
        <span className="text-[11px] font-medium text-slate-500">{task.key}</span>
        <PriorityIcon priority={task.priority} />
        {task.story_points != null && <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-full px-1.5">{task.story_points}</span>}
        <div className="ml-auto flex items-center gap-2">
          {task.blocked_by?.length > 0 && <Link2 className="w-3.5 h-3.5 text-red-400" title="Has dependencies" />}
          {task.subtask_total > 0 && <span className="flex items-center gap-0.5 text-[11px]"><GitBranch className="w-3 h-3" />{task.subtask_done}/{task.subtask_total}</span>}
          {task.checklist_total > 0 && <span className="flex items-center gap-0.5 text-[11px]"><ListChecks className="w-3 h-3" />{task.checklist_done}/{task.checklist_total}</span>}
          {task.comment_count > 0 && <span className="flex items-center gap-0.5 text-[11px]"><MessageSquare className="w-3 h-3" />{task.comment_count}</span>}
          <Avatar name={task.assignee_name} size="xs" />
        </div>
      </div>
      {task.due_date && <div className="mt-1.5"><DueDate task={task} compact /></div>}
    </div>
  );
}

/**
 * Kanban board: one column per workflow status, drag cards to change status
 * and order. Updates are optimistic; the server result is merged back in.
 */
export default function BoardView({ project, tasks, setTasks, onOpen, onCreate, editable, onChanged }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { status, index }

  const columns = useMemo(() => project.statuses.map(s => ({
    ...s,
    tasks: tasks.filter(t => t.status === s.key).sort((a, b) => a.position - b.position),
  })), [project.statuses, tasks]);

  const dropIndex = (e, columnTasks) => {
    const cards = [...e.currentTarget.querySelectorAll('[data-card-id]')];
    const y = e.clientY;
    const idx = cards.findIndex(el => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return idx === -1 ? columnTasks.length : idx;
  };

  const onDrop = async (e, column) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData('text/plain');
    setOver(null);
    setDragId(null);
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const others = column.tasks.filter(t => t.id !== id);
    // The drop index counts the dragged card if it's in this column: adjust when moving down
    const raw = over?.status === column.key ? over.index : column.tasks.length;
    const originalIndex = column.tasks.findIndex(t => t.id === id);
    const target = Math.min(originalIndex !== -1 && originalIndex < raw ? raw - 1 : raw, others.length);
    const position = positionBetween(others[target - 1]?.position, others[target]?.position);
    if (task.status === column.key && Math.abs(task.position - position) < 1e-9) return;

    const prev = tasks;
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, status: column.key, status_category: column.category, position } : t)));
    try {
      const r = await api.post(`${API}/tasks/${id}/move`, { status: column.key, position });
      (r.data.warnings || []).forEach(w => toast.warning(w));
      setTasks(ts => ts.map(t => (t.id === id ? { ...t, ...r.data } : t)));
      onChanged?.();
    } catch (err) {
      setTasks(prev);
      toast.error(errorText(err, 'Could not move the task'));
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]" data-testid="board-view">
      {columns.map(col => {
        const hours = col.tasks.reduce((s, t) => s + (t.estimate_hours || 0), 0);
        return (
          <div
            key={col.key}
            className={`flex flex-col w-72 shrink-0 rounded-xl bg-slate-100/80 ${over?.status === col.key ? 'ring-2 ring-slate-400' : ''}`}
            onDragOver={(e) => {
              if (!editable) return;
              e.preventDefault();
              const index = dropIndex(e, col.tasks);
              if (over?.status !== col.key || over?.index !== index) setOver({ status: col.key, index });
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={(e) => onDrop(e, col)}
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 truncate">{col.label}</span>
              <span className="text-xs text-slate-500">{col.tasks.length}</span>
              {hours > 0 && <span className="text-[10px] text-slate-400">· {Math.round(hours * 10) / 10}h</span>}
              {editable && (
                <button type="button" onClick={() => onCreate({ status: col.key })} className="ml-auto p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900" title="Add task">
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
              {col.tasks.map((t, i) => (
                <React.Fragment key={t.id}>
                  {over?.status === col.key && over.index === i && dragId !== t.id && <div className="h-1 rounded bg-slate-500" />}
                  <div data-card-id={t.id}>
                    <TaskCard
                      task={t}
                      project={project}
                      onOpen={onOpen}
                      draggable={editable}
                      dragging={dragId === t.id}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                    />
                  </div>
                </React.Fragment>
              ))}
              {over?.status === col.key && over.index >= col.tasks.length && <div className="h-1 rounded bg-slate-500" />}
              {col.tasks.length === 0 && <p className="text-[11px] text-slate-400 text-center py-6">{editable ? 'Drop tasks here' : 'No tasks'}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
