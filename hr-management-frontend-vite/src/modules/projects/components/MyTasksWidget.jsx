import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KanbanSquare, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import { setWorkspace } from '@/lib/workspace';
import { API, isOverdue } from '../lib';
import { PriorityIcon, DueDate, ProjectDot } from './Shared';

/** HR dashboard card: my open Xeno PM tasks, soonest due first. */
export default function MyTasksWidget() {
  const [tasks, setTasks] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`${API}/my-tasks`, { params: { limit: 50 } })
      .then(r => alive && setTasks(r.data))
      .catch(() => alive && setTasks([]));
    return () => { alive = false; };
  }, []);

  // Stay out of the way for people who don't use projects
  if (!tasks || tasks.length === 0) return null;
  const overdue = tasks.filter(isOverdue).length;

  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          <KanbanSquare className="w-5 h-5 text-slate-600" /> My project tasks
          {overdue > 0 && <span className="text-xs font-medium bg-red-100 text-red-700 rounded-full px-2 py-0.5">{overdue} overdue</span>}
        </CardTitle>
        <Link to="/pm/my-tasks" onClick={() => setWorkspace('pm')} className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">Open Xeno PM <ArrowRight className="w-3 h-3" /></Link>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 pt-0">
        <div className="divide-y divide-slate-100">
          {tasks.slice(0, 6).map(t => (
            <Link key={t.id} to={`/pm/projects/${t.project_id}?task=${t.id}`} onClick={() => setWorkspace('pm')} className="flex items-center gap-2.5 py-2 hover:bg-slate-50 -mx-2 px-2 rounded">
              <PriorityIcon priority={t.priority} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900 truncate">{t.title}</p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><ProjectDot color={t.project?.color} /> {t.key} · {t.status_label}</p>
              </div>
              <DueDate task={t} compact />
            </Link>
          ))}
        </div>
        {tasks.length > 6 && <p className="text-xs text-slate-500 mt-2">+{tasks.length - 6} more</p>}
      </CardContent>
    </Card>
  );
}
