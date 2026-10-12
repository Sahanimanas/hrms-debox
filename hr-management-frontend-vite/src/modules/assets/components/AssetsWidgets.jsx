import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Laptop, ArrowRight, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import api from '@/lib/api';
import { ASSET_STATUSES } from '../lib';

const STATUS_COLORS = { available: '#10b981', assigned: '#0ea5e9', in_repair: '#f59e0b', retired: '#94a3b8', lost: '#ef4444' };

/** Admin dashboard card: assets by status, open requests/issues, warranties. */
export function AssetsAdminWidget() {
  const [summary, setSummary] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/v2/assets/summary')
      .then(r => { if (!cancelled) setSummary(r.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;
  const data = summary ? ASSET_STATUSES.map(s => ({ name: s.label, key: s.value, value: summary.by_status[s.value] || 0 })).filter(d => d.value > 0) : [];
  const alerts = summary ? [
    summary.open_requests > 0 && { to: '/asset-requests', text: `${summary.open_requests} open asset request(s)` },
    summary.open_issues > 0 && { to: '/asset-requests?tab=issues', text: `${summary.open_issues} reported issue(s)` },
    summary.warranty_expiring_30d > 0 && { to: '/assets?warranty=expiring', text: `${summary.warranty_expiring_30d} warrant${summary.warranty_expiring_30d === 1 ? 'y' : 'ies'} expiring in 30 days` },
    summary.unacknowledged > 0 && { to: '/assets?status=assigned', text: `${summary.unacknowledged} handover(s) not acknowledged` },
  ].filter(Boolean) : [];

  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          <Package className="w-5 h-5 text-slate-600" /> Assets
        </CardTitle>
        <Link to="/assets" className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">Register <ArrowRight className="w-3 h-3" /></Link>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 pt-0">
        {!summary ? <p className="text-sm text-slate-500">Loading…</p> : summary.total === 0 ? (
          <p className="text-sm text-slate-500">No assets in the register yet. <Link to="/assets" className="text-sky-700 hover:underline">Add or import assets</Link>.</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <div className="w-full sm:w-40 h-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} paddingAngle={2}>
                    {data.map(d => <Cell key={d.key} fill={STATUS_COLORS[d.key]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3">
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {ASSET_STATUSES.map(s => (
                  <Link key={s.value} to={`/assets?status=${s.value}`} className="rounded-lg bg-slate-50 hover:bg-slate-100 p-2 text-center">
                    <p className="text-lg font-bold text-slate-900">{summary.by_status[s.value] || 0}</p>
                    <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s.value] }}></span>{s.label}</p>
                  </Link>
                ))}
              </div>
              {alerts.length > 0 && (
                <ul className="space-y-1">
                  {alerts.map(a => (
                    <li key={a.to}><Link to={a.to} className="text-xs text-amber-700 hover:underline flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {a.text}</Link></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Employee dashboard card: shown only when assets await acknowledgement. */
export function MyAssetsWidget() {
  const [assets, setAssets] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/v2/assets/my-assets')
      .then(r => { if (!cancelled) setAssets(r.data.assets || []); })
      .catch(() => { if (!cancelled) setAssets([]); });
    return () => { cancelled = true; };
  }, []);

  const pending = (assets || []).filter(a => !a.acknowledged_at);
  if (!pending.length) return null;

  return (
    <Card className="border-amber-200 bg-amber-50 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-amber-800">
          <Laptop className="w-5 h-5 shrink-0" />
          <p className="text-sm">
            {pending.length === 1 ? `${pending[0].name} (${pending[0].asset_tag}) was` : `${pending.length} assets were`} issued to you. Please acknowledge receipt.
          </p>
        </div>
        <Link to="/my-assets" className="text-sm font-medium text-amber-900 hover:underline flex items-center gap-1 shrink-0">Review <ArrowRight className="w-3.5 h-3.5" /></Link>
      </CardContent>
    </Card>
  );
}
