// Check a grievance's status by tracking code. Sent without the login token so
// the lookup is never tied to who is asking.
import { useState } from 'react';
import axios from 'axios';
import { Search, ShieldCheck, MessageSquareReply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { API, GRIEVANCE_STATUS_STYLES, errorMessage, fmtDateTime, titleCase } from '../lib';

export function GrievanceStatus({ g }) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{g.tracking_code}</span>
        <Badge variant="outline" className={`${GRIEVANCE_STATUS_STYLES[g.status]} border-0 text-[10px]`}>{g.status_label || titleCase(g.status)}</Badge>
      </div>
      <p className="font-medium text-slate-900 break-words">{g.subject}</p>
      <p className="text-xs text-slate-500">{titleCase(g.category)} · filed {fmtDateTime(g.created_at)} · updated {fmtDateTime(g.updated_at)}</p>
      {g.response && (
        <p className="text-sm bg-slate-50 rounded-lg px-3 py-2 text-slate-700 flex gap-2">
          <MessageSquareReply className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <span className="whitespace-pre-line break-words">{g.response}</span>
        </p>
      )}
      {g.history?.length > 0 && (
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {g.history.map((h, i) => <li key={i}>{titleCase(h.status)} · {fmtDateTime(h.at)}</li>)}
        </ol>
      )}
    </div>
  );
}

export default function GrievanceTracker({ initialCode = '' }) {
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (e) => {
    e?.preventDefault();
    if (code.trim().length < 6) return setError('Enter the tracking code you received');
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(`${api.defaults.baseURL}${API}/grievances/track`, { tracking_code: code.trim() });
      setResult(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Could not check the status'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={lookup} className="flex flex-col sm:flex-row gap-2">
        <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="GRV-XXXX-XXXX-XXXX" className="font-mono" maxLength={40} aria-label="Tracking code" />
        <Button type="submit" className="bg-slate-800 hover:bg-slate-900 gap-2" disabled={busy}><Search className="w-4 h-4" />{busy ? 'Checking…' : 'Check status'}</Button>
      </form>
      <p className="text-[11px] text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />Status checks are not linked to your account.</p>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {result && <GrievanceStatus g={result} />}
    </div>
  );
}
