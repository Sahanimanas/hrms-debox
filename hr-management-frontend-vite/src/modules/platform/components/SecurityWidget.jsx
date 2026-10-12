import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

/** Dashboard card: your 2FA status, plus (admins) sign-in failures in the last 24 h. */
const SecurityWidget = () => {
  const t = useT();
  const { user } = getAuth();
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/v2/platform/2fa/status').then(r => alive && setStatus(r.data)).catch(() => {});
    if (user?.role === 'admin') api.get('/v2/platform/audit-logs/summary').then(r => alive && setSummary(r.data)).catch(() => {});
    return () => { alive = false; };
  }, [user?.role]);

  if (!status) return null;
  const ok = status.enabled;

  return (
    <Card className="border-0 shadow-md">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
            {ok ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{t('Security status')}</p>
            <p className="text-xs text-slate-500">
              {ok ? 'Two-factor authentication is on.' : status.required ? 'Two-factor authentication is required for your account.' : 'Turn on two-factor authentication to protect your account.'}
              {summary && <> · {summary.failed_logins} failed sign-in{summary.failed_logins === 1 ? '' : 's'} in 24 h</>}
            </p>
          </div>
        </div>
        <Link to={summary && summary.failed_logins > 0 ? '/audit-log' : '/security'} className="text-xs font-medium text-slate-700 hover:text-slate-900 inline-flex items-center gap-1 self-end sm:self-auto">
          {ok ? 'Review' : t('Set up now')} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};

export default SecurityWidget;
