import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Rocket, ListChecks, ClipboardList } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { API, errMsg, fmtDate } from '../lib';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, ProgressBar } from '../components/ui';
import ChecklistTasks from '../components/ChecklistTasks';

const MyOnboardingPage = () => {
  const { user } = getAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'assigned' ? 'assigned' : 'mine';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/onboarding/my`);
      setData(r.data);
    } catch (e) {
      setError(errMsg(e, 'Failed to load onboarding'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateTask = async (checklistId, task, body) => {
    try {
      await api.patch(`${API}/onboarding/${checklistId}/tasks/${task.id}`, body);
      await load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to update task'));
    }
  };

  const checklist = data?.checklist;
  const assigned = useMemo(() => data?.assigned_tasks || [], [data]);
  const assignedOpen = assigned.filter(t => !t.done).length;

  // Group assigned tasks by person
  const groups = useMemo(() => {
    const map = new Map();
    for (const t of assigned) {
      if (!map.has(t.checklist_id)) map.set(t.checklist_id, { name: t.employee_name, joining: t.joining_date, tasks: [] });
      map.get(t.checklist_id).tasks.push(t);
    }
    return [...map.entries()];
  }, [assigned]);

  return (
    <PageShell>
      <PageHeader icon={Rocket} title="My Onboarding" subtitle="Your joining checklist and onboarding tasks assigned to you" />

      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <Tabs value={tab} onValueChange={(v) => setParams(v === 'assigned' ? { tab: 'assigned' } : {})}>
          <TabsList>
            <TabsTrigger value="mine">My checklist</TabsTrigger>
            <TabsTrigger value="assigned" className="gap-1.5">
              Assigned to me
              {assignedOpen > 0 && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 px-1.5 py-0 text-[10px]">{assignedOpen}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="space-y-4">
            {!checklist ? (
              <SectionCard icon={ListChecks} title="Checklist">
                <Empty icon={ListChecks} title="No onboarding checklist" hint="HR starts one when you join." />
              </SectionCard>
            ) : (
              <SectionCard
                icon={ListChecks}
                title={checklist.template_name}
                actions={<Badge className={checklist.status === 'completed' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-100'}>{checklist.status === 'completed' ? 'Completed' : 'In progress'}</Badge>}
              >
                <div className="p-3 sm:p-5 border-b border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Joined {fmtDate(checklist.joining_date)}</span>
                    <span className="font-semibold text-slate-900">{checklist.done_tasks}/{checklist.total_tasks} · {checklist.progress}%</span>
                  </div>
                  <ProgressBar value={checklist.progress} />
                  <p className="text-xs text-slate-500">You can tick tasks owned by you. Others are completed by HR, IT or your manager.</p>
                </div>
                <ChecklistTasks
                  tasks={checklist.tasks}
                  canEdit={(t) => t.owner === 'employee' || t.assignee_email === user?.email}
                  onUpdate={(t, body) => updateTask(checklist.id, t, body)}
                />
              </SectionCard>
            )}
          </TabsContent>

          <TabsContent value="assigned" className="space-y-4">
            {groups.length === 0 ? (
              <SectionCard icon={ClipboardList} title="Assigned to me">
                <Empty icon={ClipboardList} title="No onboarding tasks assigned to you" />
              </SectionCard>
            ) : groups.map(([checklistId, g]) => (
              <SectionCard
                key={checklistId}
                icon={ClipboardList}
                title={g.name}
                actions={<span className="text-xs text-slate-500">Joining {fmtDate(g.joining)}</span>}
              >
                <ChecklistTasks tasks={g.tasks} canEdit={() => true} onUpdate={(t, body) => updateTask(checklistId, t, body)} />
              </SectionCard>
            ))}
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
};

export default MyOnboardingPage;
