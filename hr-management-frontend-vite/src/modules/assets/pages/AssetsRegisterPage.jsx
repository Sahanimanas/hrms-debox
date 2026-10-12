import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Package, Plus, Upload, Download, Search, Tags, CheckCircle, UserCheck, Wrench, Archive, AlertTriangle, Trash2, FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageHeader, Pill, Loading, Empty, ErrorState, StatCard } from '../components/Shared';
import AssetFormDialog from '../components/AssetFormDialog';
import { ASSET_STATUSES, STATUS_MAP, inr, fmtDate, isoDay, categoryLabel, errorText, humanize } from '../lib';

const ALL = 'all';

export default function AssetsRegisterPage() {
  const [params, setParams] = useSearchParams();
  const [assets, setAssets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const status = params.get('status') || ALL;
  const category = params.get('category') || ALL;
  const warranty = params.get('warranty') || ALL;

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value || value === ALL) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await api.get('/v2/assets/categories');
      setCategories(data);
    } catch {
      toast.error('Failed to load categories');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = {};
      if (status !== ALL) query.status = status;
      if (category !== ALL) query.category = category;
      if (warranty !== ALL) query.warranty = warranty;
      const [items, sum] = await Promise.all([
        api.get('/v2/assets/items', { params: query }),
        api.get('/v2/assets/summary'),
      ]);
      setAssets(items.data);
      setSummary(sum.data);
    } catch (err) {
      setError(errorText(err, 'Failed to load assets'));
    } finally {
      setLoading(false);
    }
  }, [status, category, warranty]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter(a => [a.asset_tag, a.name, a.serial_number, a.brand, a.model, a.assigned_to_name, a.assigned_to_email, a.location]
      .some(v => v && String(v).toLowerCase().includes(term)));
  }, [assets, q]);

  const doExport = () => {
    exportCsv('assets', filtered, [
      { key: 'asset_tag', label: 'Asset tag' },
      { key: 'name', label: 'Name' },
      { label: 'Category', value: r => categoryLabel(categories, r.category) },
      { key: 'brand', label: 'Brand' },
      { key: 'model', label: 'Model' },
      { key: 'serial_number', label: 'Serial number' },
      { label: 'Status', value: r => STATUS_MAP[r.status]?.label || r.status },
      { key: 'condition', label: 'Condition' },
      { key: 'assigned_to_name', label: 'Assigned to' },
      { key: 'assigned_to_email', label: 'Assignee email' },
      { label: 'Purchase date', value: r => isoDay(r.purchase_date) },
      { key: 'cost', label: 'Cost (INR)' },
      { key: 'vendor', label: 'Vendor' },
      { label: 'Warranty expiry', value: r => isoDay(r.warranty_expiry) },
      { key: 'location', label: 'Location' },
      { key: 'notes', label: 'Notes' },
    ]);
  };

  const today = isoDay(new Date());
  const statusIcons = { available: CheckCircle, assigned: UserCheck, in_repair: Wrench, retired: Archive, lost: AlertTriangle };
  const statusTones = { available: 'emerald', assigned: 'sky', in_repair: 'amber', retired: 'slate', lost: 'rose' };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <PageHeader icon={Package} title="Asset Register" subtitle="Company assets, who has them and their condition">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCatsOpen(true)}><Tags className="w-4 h-4" /> Categories</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4" /> Import CSV</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={doExport} disabled={!filtered.length}><Download className="w-4 h-4" /> Export CSV</Button>
          <Button size="sm" className="gap-1.5 bg-slate-800 hover:bg-slate-900" onClick={() => setFormOpen(true)}><Plus className="w-4 h-4" /> Add asset</Button>
        </PageHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
          {ASSET_STATUSES.map(s => (
            <StatCard
              key={s.value}
              label={s.label}
              value={summary ? summary.by_status[s.value] ?? 0 : '—'}
              icon={statusIcons[s.value]}
              tone={statusTones[s.value]}
              active={status === s.value}
              onClick={() => setFilter('status', status === s.value ? ALL : s.value)}
            />
          ))}
        </div>

        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5 space-y-3">
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tag, name, serial, assignee…" className="pl-9" />
              </div>
              <div className="grid grid-cols-3 gap-2 md:w-[480px]">
                <Select value={status} onValueChange={(v) => setFilter('status', v)}>
                  <SelectTrigger className="text-xs sm:text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {ASSET_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={category} onValueChange={(v) => setFilter('category', v)}>
                  <SelectTrigger className="text-xs sm:text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All categories</SelectItem>
                    {categories.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={warranty} onValueChange={(v) => setFilter('warranty', v)}>
                  <SelectTrigger className="text-xs sm:text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Any warranty</SelectItem>
                    <SelectItem value="expiring">Expiring ≤ 30 days</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {summary && (
              <p className="text-xs text-slate-500">
                {summary.total} assets · value {inr(summary.total_value)} · {summary.open_requests} open request(s) · {summary.open_issues} open issue(s) · {summary.unacknowledged} awaiting acknowledgement
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <Loading label="Loading assets…" /> : error ? <ErrorState message={error} onRetry={load} /> : filtered.length === 0 ? (
              <Empty icon={Package} title={assets.length ? 'No assets match your search' : 'No assets yet'}>
                {!assets.length && 'Add assets one by one or import a CSV.'}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Asset</th>
                      <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Category</th>
                      <th className="text-left font-medium px-4 py-3">Status</th>
                      <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Assigned to</th>
                      <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Warranty</th>
                      <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map(a => {
                      const w = isoDay(a.warranty_expiry);
                      const expired = w && w < today;
                      return (
                        <tr key={a.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <Link to={`/assets/${a.id}`} className="font-medium text-slate-900 hover:underline">{a.asset_tag}</Link>
                            <p className="text-xs text-slate-500 truncate max-w-[220px]">{a.name}{a.brand ? ` · ${a.brand}` : ''}</p>
                            <p className="text-[11px] text-slate-400 sm:hidden">{categoryLabel(categories, a.category)}</p>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell text-slate-600">{categoryLabel(categories, a.category)}</td>
                          <td className="px-4 py-3">
                            <Pill map={STATUS_MAP} value={a.status} />
                            {a.assigned_to_email && !a.acknowledged_at && <p className="text-[10px] text-amber-600 mt-0.5">Not acknowledged</p>}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            {a.assigned_to_name ? (
                              <>
                                <p className="text-slate-900">{a.assigned_to_name}</p>
                                <p className="text-xs text-slate-500">{a.assigned_to_email}</p>
                              </>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className={`px-4 py-3 hidden lg:table-cell whitespace-nowrap ${expired ? 'text-red-600' : 'text-slate-600'}`}>{fmtDate(a.warranty_expiry)}</td>
                          <td className="px-4 py-3 hidden lg:table-cell text-slate-600">{a.location || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {formOpen && (
        <AssetFormDialog open={formOpen} onOpenChange={setFormOpen} categories={categories} onSaved={load} />
      )}
      {importOpen && <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />}
      {catsOpen && <CategoriesDialog open={catsOpen} onOpenChange={setCatsOpen} categories={categories} onChanged={loadCategories} />}
    </div>
  );
}

function ImportDialog({ open, onOpenChange, onImported }) {
  const [file, setFile] = useState(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = async () => {
    try {
      const { data } = await api.get('/v2/assets/items/import-template', { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'asset-import-template.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('Failed to download template');
    }
  };

  const submit = async () => {
    if (!file) return toast.error('Choose a CSV file');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dry_run', dryRun ? 'true' : 'false');
      const { data } = await api.post('/v2/assets/items/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      if (!data.dry_run && data.created) {
        toast.success(`Imported ${data.created} asset(s)`);
        onImported?.();
      } else if (data.dry_run) {
        toast.info(`${data.valid} row(s) valid, ${data.failed} with errors`);
      }
    } catch (error) {
      toast.error(errorText(error, 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Import assets from CSV</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Required columns: <span className="font-mono text-xs">asset_tag, name, category</span>. Optional: brand, model, serial_number, purchase_date (YYYY-MM-DD), cost, vendor, warranty_expiry, condition, location, notes, status.
            <button type="button" onClick={downloadTemplate} className="text-sky-700 hover:underline ml-1">Download template</button>
          </p>
          <Input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(!!v)} />
            Validate only (don’t import yet)
          </label>
          {result && (
            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <p className="text-sm">
                {result.total} row(s): <span className="text-emerald-700 font-medium">{result.valid} valid</span>,{' '}
                <span className="text-red-700 font-medium">{result.failed} with errors</span>
                {!result.dry_run && <> · <span className="font-medium">{result.created} imported</span></>}
              </p>
              {result.errors.length > 0 && (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500"><tr><th className="text-left py-1 pr-2">Row</th><th className="text-left py-1 pr-2">Tag</th><th className="text-left py-1">Problems</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.errors.map(e => (
                        <tr key={e.row}><td className="py-1 pr-2 align-top">{e.row}</td><td className="py-1 pr-2 align-top">{e.asset_tag || '—'}</td><td className="py-1 text-red-700">{e.errors.join('; ')}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.errors.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => exportCsv('asset-import-errors', result.errors, [
                  { key: 'row', label: 'Row' }, { key: 'asset_tag', label: 'Asset tag' }, { label: 'Errors', value: r => r.errors.join('; ') },
                ])}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Download errors
                </Button>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={submit} disabled={busy || !file} className="bg-slate-800 hover:bg-slate-900">
            {busy ? 'Working…' : dryRun ? 'Validate' : 'Import valid rows'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ open, onOpenChange, categories, onChanged }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.post('/v2/assets/categories', { label: label.trim() });
      toast.success('Category added');
      setLabel('');
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Failed to add category'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key) => {
    try {
      await api.delete(`/v2/assets/categories/${key}`);
      toast.success('Category removed');
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Failed to remove category'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Asset categories</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="cat-new" className="sr-only">New category</Label>
              <Input id="cat-new" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Headset" onKeyDown={(e) => e.key === 'Enter' && add()} />
            </div>
            <Button onClick={add} disabled={busy || !label.trim()} className="bg-slate-800 hover:bg-slate-900"><Plus className="w-4 h-4" /></Button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {categories.map(c => (
              <div key={c.key} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{c.label} {c.builtin && <span className="text-[10px] text-slate-400 ml-1">built-in</span>}</span>
                {!c.builtin && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => remove(c.key)} aria-label={`Delete ${c.label}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">{humanize('categories in use cannot be deleted.')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
