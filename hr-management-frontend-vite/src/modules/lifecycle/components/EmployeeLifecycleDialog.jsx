// Lifecycle view of one employee (status, onboarding, separation, job history,
// documents, personal details). Used from the Employees page.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { API, errMsg, fmtDate, humanize, EMPLOYMENT_STATUS, SEPARATION_STATUS } from '../lib';
import { Loading, StatusPill, ProgressBar, Avatar, Empty } from './ui';
import JobHistoryTimeline from './JobHistoryTimeline';
import DocumentList from './DocumentList';
import DocumentUploadDialog from './DocumentUploadDialog';

const Fact = ({ label, children }) => (
  <div>
    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
    <div className="text-sm text-slate-900">{children}</div>
  </div>
);

const Body = ({ uid, isAdmin }) => {
  const [overview, setOverview] = useState(null);
  const [docs, setDocs] = useState(null);
  const [personal, setPersonal] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const [version, setVersion] = useState(0);
  const reload = () => setVersion(v => v + 1);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.get(`${API}/people/${encodeURIComponent(uid)}/overview`),
      api.get(`${API}/personal/${encodeURIComponent(uid)}`),
      isAdmin ? api.get(`${API}/documents`, { params: { employee_uid: uid } }) : Promise.resolve({ data: [] }),
    ]).then(([o, p, d]) => {
      if (!alive) return;
      if (o.status === 'fulfilled') setOverview(o.value.data);
      else toast.error(errMsg(o.reason, 'Failed to load employee'));
      setPersonal(p.status === 'fulfilled' ? p.value.data : {});
      setDocs(d.status === 'fulfilled' ? d.value.data || [] : []);
    });
    return () => { alive = false; };
  }, [uid, isAdmin, version]);

  if (!overview) return <Loading />;
  const e = overview.employee;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={e.full_name} size="lg" />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 truncate">{e.full_name}</p>
          <p className="text-xs text-slate-500 truncate">{e.designation || '—'} · {e.department || '—'} · {e.employee_id}</p>
          <div className="mt-1"><StatusPill map={EMPLOYMENT_STATUS} status={e.employment_status} /></div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 rounded-lg p-3">
        <Fact label="Joined">{fmtDate(e.joining_date)}</Fact>
        <Fact label={e.confirmation_date ? 'Confirmed' : 'Probation ends'}>{fmtDate(e.confirmation_date || e.probation_end_date)}</Fact>
        <Fact label="Manager">{e.manager_name || '—'}</Fact>
        <Fact label="Exit date">{fmtDate(e.exit_date)}</Fact>
        {overview.onboarding && (
          <div className="col-span-2">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Onboarding</p>
            <div className="flex items-center gap-2"><ProgressBar value={overview.onboarding.progress} className="flex-1" /><span className="text-xs font-medium">{overview.onboarding.progress}%</span></div>
          </div>
        )}
        {overview.separation && (
          <div className="col-span-2">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Separation</p>
            <div className="flex items-center gap-2 text-sm">
              <StatusPill map={SEPARATION_STATUS} status={overview.separation.status} />
              <span className="capitalize">{overview.separation.type}</span>
              <Link to="/offboarding" className="text-xs underline text-slate-600">Open</Link>
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="history">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="history">Job history</TabsTrigger>
          <TabsTrigger value="personal">Personal</TabsTrigger>
          {isAdmin && <TabsTrigger value="documents">Documents{docs ? ` (${docs.length})` : ''}</TabsTrigger>}
        </TabsList>
        <TabsContent value="history" className="pt-2">
          <JobHistoryTimeline uid={uid} canAdd={isAdmin} compact />
        </TabsContent>
        <TabsContent value="personal" className="pt-2">
          {!personal ? <Loading /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(personal).map(([k, v]) => (
                <Fact key={k} label={humanize(k)}>{v ? (k === 'date_of_birth' ? fmtDate(v) : String(v).match(/^[a-z_]+$/) && k !== 'personal_email' ? humanize(v) : String(v)) : '—'}</Fact>
              ))}
              {Object.keys(personal).length === 0 && <p className="text-sm text-slate-500">Not available</p>}
            </div>
          )}
        </TabsContent>
        {isAdmin && (
          <TabsContent value="documents" className="pt-2 space-y-2">
            <div className="flex justify-end"><Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setUploadOpen(true)}><Upload className="w-3.5 h-3.5" />Upload</Button></div>
            {!docs ? <Loading /> : docs.length === 0 ? <Empty title="No documents" /> : (
              <div className="border border-slate-200 rounded-lg"><DocumentList docs={docs} /></div>
            )}
            <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={reload} defaultEmployeeUid={uid} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

const EmployeeLifecycleDialog = ({ uid, open, onOpenChange, isAdmin }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Employee lifecycle</DialogTitle></DialogHeader>
      {open && uid && <Body key={uid} uid={uid} isAdmin={isAdmin} />}
    </DialogContent>
  </Dialog>
);

export default EmployeeLifecycleDialog;
