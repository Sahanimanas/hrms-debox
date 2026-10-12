// Document table shared by My Documents and the admin vault.
import React from 'react';
import { FileText, Download, Eye, Trash2, ShieldCheck, ShieldX, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { API, fmtDate, VERIFICATION_STATUS, downloadFile } from '../lib';
import { StatusPill } from './ui';

const ExpiryBadge = ({ doc }) => {
  if (!doc.expiry_date) return <span className="text-slate-400">—</span>;
  if (doc.expiry_state === 'expired') return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1 text-[10px]"><AlertTriangle className="w-3 h-3" />Expired {fmtDate(doc.expiry_date)}</Badge>;
  if (doc.expiry_state === 'expiring') return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1 text-[10px]"><AlertTriangle className="w-3 h-3" />{fmtDate(doc.expiry_date)}</Badge>;
  return <span className="text-xs text-slate-600">{fmtDate(doc.expiry_date)}</span>;
};

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const DocumentList = ({ docs, showEmployee = false, canDelete, onDelete, onVerify }) => {
  const download = (doc, inline) =>
    downloadFile(`${API}/documents/${doc.id}/download`, doc.file_name, { inline }).catch(() => toast.error('Download failed'));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left font-medium px-4 py-3">Document</th>
            {showEmployee && <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Employee</th>}
            <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Expiry</th>
            <th className="text-left font-medium px-4 py-3">Status</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {docs.map(doc => (
            <tr key={doc.id} className="hover:bg-slate-50 align-top">
              <td className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 break-words">{doc.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {doc.type_label || doc.type} · {fmtSize(doc.size || 0)} · {fmtDate(doc.created_at)}
                      {doc.source === 'letter' && ' · Issued letter'}
                    </p>
                    {showEmployee && <p className="text-[11px] text-slate-500 sm:hidden">{doc.employee_name}</p>}
                    <div className="md:hidden mt-1"><ExpiryBadge doc={doc} /></div>
                    {doc.verification_status === 'rejected' && doc.rejection_reason && (
                      <p className="text-[11px] text-red-600 mt-0.5">Rejected: {doc.rejection_reason}</p>
                    )}
                  </div>
                </div>
              </td>
              {showEmployee && (
                <td className="px-4 py-3 hidden sm:table-cell">
                  <p className="text-slate-900">{doc.employee_name}</p>
                  <p className="text-[11px] text-slate-500">{doc.employee_uid}</p>
                </td>
              )}
              <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap"><ExpiryBadge doc={doc} /></td>
              <td className="px-4 py-3"><StatusPill map={VERIFICATION_STATUS} status={doc.verification_status} /></td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-0.5">
                  {(doc.mime_type === 'application/pdf' || doc.mime_type?.startsWith('image/')) && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="View" onClick={() => download(doc, true)}><Eye className="w-4 h-4" /></Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Download" onClick={() => download(doc, false)}><Download className="w-4 h-4" /></Button>
                  {onVerify && doc.verification_status !== 'verified' && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" aria-label="Verify" onClick={() => onVerify(doc, 'verified')}><ShieldCheck className="w-4 h-4" /></Button>
                  )}
                  {onVerify && doc.verification_status !== 'rejected' && doc.source === 'upload' && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" aria-label="Reject" onClick={() => onVerify(doc, 'rejected')}><ShieldX className="w-4 h-4" /></Button>
                  )}
                  {onDelete && canDelete(doc) && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" aria-label="Delete" onClick={() => onDelete(doc)}><Trash2 className="w-4 h-4" /></Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DocumentList;
