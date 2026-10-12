import React from 'react';
import { Bot, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { getAuth } from '@/lib/auth';
import PageHeader, { PageShell } from '../components/PageHeader';
import AssistantChat from '../components/AssistantChat';

const AssistantPage = () => {
  const { user } = getAuth();
  return (
    <PageShell>
      <PageHeader icon={Bot} title="AI Assistant" subtitle="Ask about your leave, attendance, payslips, holidays and company policies" />
      <Card className="border-0 shadow-md overflow-hidden flex flex-col h-[calc(100vh-15rem)] min-h-[420px] bg-slate-50">
        <AssistantChat isAdmin={user?.role === 'admin'} />
      </Card>
      <p className="text-xs text-slate-500 flex items-start gap-1.5">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        The assistant can only look up your own records{user?.role === 'admin' ? ' plus company-wide counts for admins' : ''}. It can't make changes, and answers may be imperfect — check important details on the relevant page.
      </p>
    </PageShell>
  );
};

export default AssistantPage;
