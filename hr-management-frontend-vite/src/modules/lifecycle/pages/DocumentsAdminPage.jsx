import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderLock, Upload, Download, Search, AlertTriangle, FileText, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg } from '../lib';
import { useEmployees } from '../hooks';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatTile, NativeSelect } from '../components/ui';
import DocumentList from '../components/DocumentList';
import DocumentUploadDialog from '../components/DocumentUploadDialog';

const csvColumns = [
  { key: 'employee_name', label: 'Employee' },
  { key: 'employee_uid', label: 'Employee ID' },
  { key: 'title', label: 'Title' },
  { key: 'type_label', label: 'Type' },
  { key: 'verification_status', label: 'Status' },
  { key: 'expiry_date', label: 'Expiry' },
  { key: 'source', label: 'Source' },
  { label: 'Uploaded', value: r => r.created_at?.slice(0, 10) },
];

const DocumentsAdminPage = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'expiring' ? 'expiring' : 'all';
  const [docs, setDocs] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ q: '', type: '', status: '', employee_uid: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const employees = useEmployees(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const [a, b] = await Promise.all([
        api.get(`${API}/documents`, { params }),
        api.get(`${API}/documents/expiring`, { params: { days: 30 } }),
      ]);
      setDocs(a.data || []);
      setExpiring(b.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load documents'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);
  useEffect(() => { api.get(`${API}/documents/types`).then(r => setTypes(r.data || [])).catch(() => {}); }, []);

  const verify = async (doc, status) => {
    let reason = null;
    if (status === 'rejected') {
      reason = window.prompt('Reason for rejecting this document?');
      if (!reason) return;
    }
    try {
      await api.post(`${API}/documents/${doc.id}/verify`, { status, reason });
      toast.success(status === 'verified' ? 'Document verified' : 'Document rejected');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to update'));
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}" for ${doc.employee_name}? This cannot be undone.`)) return;
    try {
      await api.delete(`${API}/documents/${doc.id}`);
      toast.success('Document deleted');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to delete'));
    }
  };

  const pending = useMemo(() => docs.filter(d => d.verification_status === 'pending').length, [docs]);
  const expired = expiring.filter(d => d.expiry_state === 'expired').length;

  return (
    <PageShell>
      <PageHeader icon={FolderLock} title="Document Vault" subtitle="Every employee's documents, verification and expiry">
        <Button onClick={() => setUploadOpen(true)} className="bg-slate-800 hover:bg-slate-900 gap-2 w-full sm:w-auto"><Upload className="w-4 h-4" />Upload for employee</Button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="Pending review" value={pending} icon={Clock} tone="amber" onClick={() => { setFilters({ ...filters, status: 'pending' }); setParams({}); }} />
        <StatTile label="Expiring ≤ 30 days" value={expiring.length - expired} icon={AlertTriangle} tone="amber" onClick={() => setParams({ tab: 'expiring' })} />
        <StatTile label="Expired" value={expired} icon={AlertTriangle} tone="rose" onClick={() => setParams({ tab: 'expiring' })} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'expiring' ? { tab: 'expiring' } : {})}>
        <TabsList>
          <TabsTrigger value="all">All documents</TabsTrigger>
          <TabsTrigger value="expiring">Expiring soon ({expiring.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <SectionCard
            icon={FileText}
            title="Documents"
            actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={!docs.length} onClick={() => exportCsv('documents', docs, csvColumns)}><Download className="w-3.5 h-3.5" />Export CSV</Button>}
          >
            <div className="p-3 sm:p-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="relative sm:col-span-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input className="pl-9" placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              </div>
              <NativeSelect value={filters.employee_uid} onChange={(v) => setFilters({ ...filters, employee_uid: v })}>
                <option value="">All employees</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </NativeSelect>
              <NativeSelect value={filters.type} onChange={(v) => setFilters({ ...filters, type: v })}>
                <option value="">All types</option>
                {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </NativeSelect>
              <NativeSelect value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
                <option value="">Any status</option>
                <option value="pending">Pending review</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </NativeSelect>
            </div>
            {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : docs.length === 0 ? (
              <Empty icon={FileText} title="No documents match" />
            ) : (
              <DocumentList docs={docs} showEmployee canDelete={() => true} onDelete={remove} onVerify={verify} />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="expiring">
          <SectionCard
            icon={AlertTriangle}
            title="Expiring within 30 days or expired"
            actions={<Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={!expiring.length} onClick={() => exportCsv('documents-expiring', expiring, csvColumns)}><Download className="w-3.5 h-3.5" />Export CSV</Button>}
          >
            {loading ? <Loading /> : expiring.length === 0 ? (
              <Empty icon={AlertTriangle} title="Nothing expiring" hint="Owners and admins are notified automatically by the daily expiry job." />
            ) : (
              <DocumentList docs={expiring} showEmployee canDelete={() => true} onDelete={remove} onVerify={verify} />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={load} employees={employees} />
    </PageShell>
  );
};

export default DocumentsAdminPage;
