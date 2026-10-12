import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderLock, Upload, Download, FileText, AlertTriangle, ShieldCheck, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg } from '../lib';
import { PageShell, PageHeader, SectionCard, Loading, Empty, ErrorState, StatTile } from '../components/ui';
import DocumentList from '../components/DocumentList';
import DocumentUploadDialog from '../components/DocumentUploadDialog';

const MyDocumentsPage = () => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/documents/my`);
      setDocs(r.data || []);
    } catch (e) {
      setError(errMsg(e, 'Failed to load documents'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api.delete(`${API}/documents/${doc.id}`);
      toast.success('Document deleted');
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Failed to delete'));
    }
  };

  const letters = useMemo(() => docs.filter(d => d.source === 'letter' || d.source === 'settlement'), [docs]);
  const uploads = useMemo(() => docs.filter(d => d.source !== 'letter' && d.source !== 'settlement'), [docs]);
  const expiring = docs.filter(d => d.expiry_state === 'expiring' || d.expiry_state === 'expired').length;

  const doExport = () => exportCsv('my-documents', docs, [
    { key: 'title', label: 'Title' },
    { key: 'type_label', label: 'Type' },
    { key: 'verification_status', label: 'Status' },
    { key: 'expiry_date', label: 'Expiry' },
    { key: 'file_name', label: 'File' },
    { label: 'Uploaded', value: r => r.created_at?.slice(0, 10) },
  ]);

  return (
    <PageShell>
      <PageHeader icon={FolderLock} title="My Documents" subtitle="Your offer letter, contracts, ID and certificates in one place">
        <Button variant="outline" className="gap-2 flex-1 sm:flex-none" onClick={doExport} disabled={!docs.length}><Download className="w-4 h-4" />Export CSV</Button>
        <Button onClick={() => setUploadOpen(true)} className="bg-slate-800 hover:bg-slate-900 gap-2 flex-1 sm:flex-none"><Upload className="w-4 h-4" />Upload</Button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="Documents" value={docs.length} icon={FileText} />
        <StatTile label="Verified" value={docs.filter(d => d.verification_status === 'verified').length} icon={ShieldCheck} tone="emerald" />
        <StatTile label="Expiring" value={expiring} icon={AlertTriangle} tone={expiring ? 'rose' : 'slate'} />
      </div>

      {loading && !docs.length ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <SectionCard icon={Mail} title="Letters issued to you">
            {letters.length === 0 ? <Empty icon={Mail} title="No letters yet" hint="Offer, appointment and experience letters from HR appear here." /> : (
              <DocumentList docs={letters} />
            )}
          </SectionCard>
          <SectionCard icon={FileText} title="Uploaded documents">
            {uploads.length === 0 ? <Empty icon={FileText} title="Nothing uploaded yet" hint="Upload your ID proof, address proof and certificates." /> : (
              <DocumentList docs={uploads} canDelete={(d) => d.verification_status !== 'verified'} onDelete={remove} />
            )}
          </SectionCard>
        </>
      )}

      <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={load} />
    </PageShell>
  );
};

export default MyDocumentsPage;
