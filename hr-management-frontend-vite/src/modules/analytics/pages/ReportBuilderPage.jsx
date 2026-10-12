import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Wrench, Plus, Trash2, Play, Download, Save, ArrowLeft, Loader2, Filter as FilterIcon, Columns3, CalendarClock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import AnalyticsShell from '../components/AnalyticsShell';
import ResultTable from '../components/ResultTable';
import { downloadServerCsvPost, errorText, WEEKDAYS } from '../lib';

const OP_LABELS = {
  equals: 'is', not_equals: 'is not', contains: 'contains', in: 'is one of', between: 'between',
  gt: '>', gte: '≥', lt: '<', lte: '≤', before: 'before', after: 'after', on_or_before: 'on or before',
  on_or_after: 'on or after', is_empty: 'is empty', not_empty: 'is not empty',
};
const AGG_LABELS = { count: 'Count rows', sum: 'Sum of', avg: 'Average of', min: 'Minimum of', max: 'Maximum of' };

const EMPTY_SCHEDULE = { enabled: true, frequency: 'weekly', time: '09:00', day_of_week: 1, day_of_month: 1, recipients: '' };

const blankDefinition = (ds) => ({
  dataset: ds?.key || '',
  fields: ds?.default_fields || [],
  filters: [],
  group_by: [],
  aggregates: [],
  sort: [],
  limit: 1000,
});

/** UI state -> API definition (typed filter values). */
const toDefinition = (def, ds, summary) => {
  const typeOf = (k) => ds?.fields.find(f => f.key === k)?.type;
  const coerce = (type, v) => (type === 'number' && v !== '' && v != null ? Number(v) : v);
  return {
    dataset: def.dataset,
    fields: summary ? [] : def.fields,
    filters: def.filters.filter(f => f.field && f.op).map(f => {
      const type = typeOf(f.field);
      let value;
      if (f.op === 'is_empty' || f.op === 'not_empty') value = null;
      else if (f.op === 'between') value = [coerce(type, f.value), coerce(type, f.value2)];
      else if (f.op === 'in') value = String(f.value || '').split(',').map(x => x.trim()).filter(Boolean).map(x => coerce(type, x));
      else if (type === 'boolean') value = f.value === 'true';
      else value = coerce(type, f.value);
      return { field: f.field, op: f.op, value };
    }),
    group_by: summary ? def.group_by.filter(Boolean) : [],
    aggregates: summary ? def.aggregates.filter(a => a.fn).map(a => ({ fn: a.fn, field: a.fn === 'count' ? null : a.field })) : [],
    sort: def.sort.filter(s => s.field),
    limit: Number(def.limit) || 1000,
  };
};

/** API definition -> UI state. */
const fromDefinition = (d) => ({
  dataset: d.dataset,
  fields: d.fields || [],
  filters: (d.filters || []).map(f => ({
    field: f.field,
    op: f.op,
    value: Array.isArray(f.value) ? (f.op === 'between' ? String(f.value[0] ?? '') : f.value.join(', ')) : f.value == null ? '' : String(f.value),
    value2: f.op === 'between' && Array.isArray(f.value) ? String(f.value[1] ?? '') : '',
  })),
  group_by: d.group_by || [],
  aggregates: d.aggregates || [],
  sort: d.sort || [],
  limit: d.limit || 1000,
});

const FilterValue = ({ field, filter, onChange }) => {
  if (!field || filter.op === 'is_empty' || filter.op === 'not_empty') return null;
  const inputType = field.type === 'number' ? 'number' : (field.type === 'date' || field.type === 'datetime') ? 'date' : 'text';
  if (field.type === 'boolean') {
    return (
      <Select value={filter.value || 'true'} onValueChange={(v) => onChange({ ...filter, value: v })}>
        <SelectTrigger className="h-9 text-sm sm:w-32"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
      </Select>
    );
  }
  if (filter.op === 'between') {
    return (
      <div className="flex items-center gap-1.5">
        <Input type={inputType} className="h-9 text-sm sm:w-36" value={filter.value ?? ''} onChange={(e) => onChange({ ...filter, value: e.target.value })} aria-label="From" />
        <span className="text-xs text-slate-500">and</span>
        <Input type={inputType} className="h-9 text-sm sm:w-36" value={filter.value2 ?? ''} onChange={(e) => onChange({ ...filter, value2: e.target.value })} aria-label="To" />
      </div>
    );
  }
  return (
    <Input
      type={filter.op === 'in' ? 'text' : inputType}
      className="h-9 text-sm sm:w-56"
      placeholder={filter.op === 'in' ? 'Comma-separated values' : 'Value'}
      value={filter.value ?? ''}
      onChange={(e) => onChange({ ...filter, value: e.target.value })}
      aria-label="Value"
    />
  );
};

const ReportBuilderPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = getAuth();
  const isAdmin = user?.role === 'admin';

  const [catalog, setCatalog] = useState([]);
  const [def, setDef] = useState(blankDefinition(null));
  const [summary, setSummary] = useState(false);
  const [meta, setMeta] = useState({ name: '', description: '', shared_with_managers: false });
  const [scheduleOn, setScheduleOn] = useState(false);
  const [schedule, setSchedule] = useState(EMPTY_SCHEDULE);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const ds = useMemo(() => catalog.find(d => d.key === def.dataset), [catalog, def.dataset]);
  const fieldByKey = useMemo(() => Object.fromEntries((ds?.fields || []).map(f => [f.key, f])), [ds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cat = await api.get('/v2/analytics/reports/datasets');
      setCatalog(cat.data.datasets);
      if (id) {
        const r = await api.get(`/v2/analytics/reports/${id}`);
        const rep = r.data;
        setDef(fromDefinition(rep.definition));
        setSummary((rep.definition.group_by || []).length > 0 || (rep.definition.aggregates || []).length > 0);
        setMeta({ name: rep.name, description: rep.description || '', shared_with_managers: !!rep.shared_with_managers });
        if (rep.schedule) {
          setScheduleOn(true);
          setSchedule({ ...EMPTY_SCHEDULE, ...rep.schedule, recipients: (rep.schedule.recipients || []).join(', ') });
        }
      } else {
        setDef(blankDefinition(cat.data.datasets[0]));
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load the report builder');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (isAdmin) load(); }, [load, isAdmin]);

  const outputColumns = useMemo(() => {
    if (!ds) return [];
    if (!summary) return def.fields.map(k => ({ key: k, label: fieldByKey[k]?.label || k }));
    return [
      ...def.group_by.filter(Boolean).map(k => ({ key: k, label: fieldByKey[k]?.label || k })),
      ...def.aggregates.filter(a => a.fn && (a.fn === 'count' || a.field)).map(a => (
        a.fn === 'count' ? { key: 'count', label: 'Count' } : { key: `${a.fn}_${a.field}`, label: `${AGG_LABELS[a.fn]} ${fieldByKey[a.field]?.label || a.field}` }
      )),
    ];
  }, [ds, summary, def, fieldByKey]);

  const setDataset = (key) => {
    setDef(blankDefinition(catalog.find(d => d.key === key)));
    setSummary(false);
    setResult(null);
  };
  const toggleField = (key, on) => setDef(d => ({ ...d, fields: on ? [...d.fields, key] : d.fields.filter(f => f !== key) }));
  const setFilter = (i, f) => setDef(d => ({ ...d, filters: d.filters.map((x, j) => (j === i ? f : x)) }));
  const setAgg = (i, a) => setDef(d => ({ ...d, aggregates: d.aggregates.map((x, j) => (j === i ? a : x)) }));
  const setGroup = (i, v) => setDef(d => {
    const g = [...d.group_by];
    if (v === '__none') g.splice(i, 1); else g[i] = v;
    return { ...d, group_by: g };
  });
  const enableSummary = (on) => {
    setSummary(on);
    setDef(d => ({ ...d, sort: [], ...(on && !d.aggregates.length ? { aggregates: [{ fn: 'count', field: null }] } : {}) }));
  };

  const definition = () => toDefinition(def, ds, summary);

  const preview = async () => {
    setRunning(true);
    try {
      const r = await api.post('/v2/analytics/reports/preview', { definition: definition() });
      setResult(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Report failed');
    } finally {
      setRunning(false);
    }
  };

  const downloadCsv = async () => {
    try {
      await downloadServerCsvPost('/v2/analytics/reports/preview', { definition: definition(), format: 'csv' }, `report-${def.dataset}.csv`);
    } catch (e) {
      toast.error(await errorText(e, 'Export failed'));
    }
  };

  const save = async () => {
    if (!meta.name.trim()) return toast.error('Give the report a name');
    let sched = null;
    if (scheduleOn) {
      const recipients = schedule.recipients.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
      if (!recipients.length) return toast.error('Add at least one recipient email');
      sched = { enabled: schedule.enabled, frequency: schedule.frequency, time: schedule.time, recipients };
      if (schedule.frequency === 'weekly') sched.day_of_week = Number(schedule.day_of_week);
      if (schedule.frequency === 'monthly') sched.day_of_month = Number(schedule.day_of_month);
    }
    const body = { name: meta.name.trim(), description: meta.description, shared_with_managers: meta.shared_with_managers, definition: definition(), schedule: sched };
    setSaving(true);
    try {
      if (id) {
        await api.put(`/v2/analytics/reports/${id}`, body);
        toast.success('Report updated');
      } else {
        const r = await api.post('/v2/analytics/reports', body);
        toast.success('Report saved');
        navigate(`/analytics/reports/${r.data.id}/edit`, { replace: true });
      }
    } catch (e) {
      const d = e.response?.data;
      toast.error(d?.errors?.[0]?.message || d?.detail || 'Failed to save report');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <AnalyticsShell icon={Wrench} title="Report Builder">
        <Card className="border-0 shadow-md"><CardContent className="py-12 text-center text-slate-500 text-sm"><Lock className="w-8 h-8 mx-auto mb-2 text-slate-300" />Only admins can build reports. Open <Link to="/analytics/reports" className="underline">Reports</Link> to run the ones shared with you.</CardContent></Card>
      </AnalyticsShell>
    );
  }

  const numberFields = (ds?.fields || []).filter(f => f.type === 'number');
  const minMaxFields = (ds?.fields || []).filter(f => ['number', 'date', 'datetime'].includes(f.type));

  return (
    <AnalyticsShell
      icon={Wrench}
      title={id ? 'Edit Report' : 'Report Builder'}
      subtitle="Pick a dataset, columns and filters; preview, download or schedule it"
      actions={
        <Button variant="outline" className="gap-2 h-9 text-xs sm:text-sm" onClick={() => navigate('/analytics/reports')}>
          <ArrowLeft className="w-4 h-4" /> Saved reports
        </Button>
      }
    >
      {loading ? (
        <div className="text-center py-16"><div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
      ) : (
        <>
          {/* Dataset & columns */}
          <Card className="border-0 shadow-md">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2"><Columns3 className="w-4 h-4 text-slate-600" /> Data</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="space-y-1.5 sm:w-64">
                  <Label>Dataset</Label>
                  <Select value={def.dataset} onValueChange={setDataset}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Choose a dataset" /></SelectTrigger>
                    <SelectContent>
                      {catalog.map(d => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:pb-2">
                  <Switch checked={summary} onCheckedChange={enableSummary} />
                  Summarise (group and aggregate)
                </label>
              </div>
              {ds && <p className="text-xs text-slate-500">{ds.description}</p>}

              {!summary && ds && (
                <div>
                  <Label className="text-xs text-slate-500 uppercase tracking-wider">Columns</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {ds.fields.map(f => (
                      <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700 rounded-md border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50">
                        <Checkbox checked={def.fields.includes(f.key)} onCheckedChange={(v) => toggleField(f.key, !!v)} />
                        <span className="truncate">{f.label}</span>
                        <span className="ml-auto text-[10px] text-slate-400">{f.type}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {summary && ds && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-500 uppercase tracking-wider">Group by (up to 3)</Label>
                    {[...def.group_by, ...(def.group_by.length < 3 ? [''] : [])].map((g, i) => (
                      <Select key={`g-${i}`} value={g || '__none'} onValueChange={(v) => setGroup(i, v)}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Add a grouping…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">{g ? 'Remove grouping' : 'No grouping'}</SelectItem>
                          {ds.fields.filter(f => f.key === g || !def.group_by.includes(f.key)).map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-500 uppercase tracking-wider">Measures</Label>
                    {def.aggregates.map((a, i) => (
                      <div key={`a-${i}`} className="flex gap-2">
                        <Select value={a.fn} onValueChange={(v) => setAgg(i, { fn: v, field: v === 'count' ? null : a.field })}>
                          <SelectTrigger className="h-9 text-sm w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(AGG_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                        </Select>
                        {a.fn !== 'count' && (
                          <Select value={a.field || ''} onValueChange={(v) => setAgg(i, { ...a, field: v })}>
                            <SelectTrigger className="h-9 text-sm flex-1"><SelectValue placeholder="Field" /></SelectTrigger>
                            <SelectContent>
                              {(a.fn === 'min' || a.fn === 'max' ? minMaxFields : numberFields).map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Remove measure" onClick={() => setDef(d => ({ ...d, aggregates: d.aggregates.filter((_, j) => j !== i) }))}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {def.aggregates.length < 10 && (
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => setDef(d => ({ ...d, aggregates: [...d.aggregates, { fn: numberFields.length ? 'sum' : 'count', field: numberFields[0]?.key || null }] }))}>
                        <Plus className="w-3.5 h-3.5" /> Add measure
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Filters, sort, limit */}
          <Card className="border-0 shadow-md">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2"><FilterIcon className="w-4 h-4 text-slate-600" /> Filters &amp; sorting</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-3">
              {def.filters.length === 0 && <p className="text-sm text-slate-500">No filters — every row is included.</p>}
              {def.filters.map((f, i) => {
                const field = fieldByKey[f.field];
                return (
                  <div key={`f-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <Select value={f.field} onValueChange={(v) => setFilter(i, { field: v, op: fieldByKey[v]?.ops[0], value: '', value2: '' })}>
                      <SelectTrigger className="h-9 text-sm sm:w-48"><SelectValue placeholder="Field" /></SelectTrigger>
                      <SelectContent>{(ds?.fields || []).map(x => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={f.op} onValueChange={(v) => setFilter(i, { ...f, op: v })}>
                      <SelectTrigger className="h-9 text-sm sm:w-36"><SelectValue placeholder="Operator" /></SelectTrigger>
                      <SelectContent>{(field?.ops || []).map(op => <SelectItem key={op} value={op}>{OP_LABELS[op] || op}</SelectItem>)}</SelectContent>
                    </Select>
                    <FilterValue field={field} filter={f} onChange={(nf) => setFilter(i, nf)} />
                    <Button variant="ghost" size="icon" className="h-9 w-9 sm:ml-auto self-end sm:self-auto" aria-label="Remove filter" onClick={() => setDef(d => ({ ...d, filters: d.filters.filter((_, j) => j !== i) }))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
              {def.filters.length < 20 && ds && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setDef(d => ({ ...d, filters: [...d.filters, { field: ds.fields[0].key, op: ds.fields[0].ops[0], value: '', value2: '' }] }))}>
                  <Plus className="w-3.5 h-3.5" /> Add filter
                </Button>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-1.5 sm:w-56">
                  <Label>Sort by</Label>
                  <Select value={def.sort[0]?.field || '__none'} onValueChange={(v) => setDef(d => ({ ...d, sort: v === '__none' ? [] : [{ field: v, direction: d.sort[0]?.direction || 'asc' }] }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Default order</SelectItem>
                      {outputColumns.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:w-40">
                  <Label>Direction</Label>
                  <Select value={def.sort[0]?.direction || 'asc'} disabled={!def.sort[0]} onValueChange={(v) => setDef(d => ({ ...d, sort: d.sort.length ? [{ ...d.sort[0], direction: v }] : [] }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="asc">Ascending</SelectItem><SelectItem value="desc">Descending</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:w-32">
                  <Label htmlFor="limit">Row limit</Label>
                  <Input id="limit" type="number" min={1} max={10000} className="h-9" value={def.limit} onChange={(e) => setDef(d => ({ ...d, limit: e.target.value }))} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={preview} disabled={running || !ds} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9">
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run preview
                </Button>
                <Button variant="outline" onClick={downloadCsv} disabled={!ds} className="gap-2 h-9">
                  <Download className="w-4 h-4" /> Download CSV
                </Button>
              </div>
            </CardContent>
          </Card>

          {result && <ResultTable result={result} title="Preview" />}

          {/* Save & schedule */}
          <Card className="border-0 shadow-md">
            <CardHeader className="border-b border-slate-100 p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2"><CalendarClock className="w-4 h-4 text-slate-600" /> Save &amp; schedule</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rep-name">Name</Label>
                  <Input id="rep-name" value={meta.name} maxLength={120} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="e.g. Monthly headcount by department" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rep-desc">Description <span className="text-slate-400 font-normal">(optional)</span></Label>
                  <Textarea id="rep-desc" rows={1} value={meta.description} maxLength={500} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Switch checked={meta.shared_with_managers} onCheckedChange={(v) => setMeta({ ...meta, shared_with_managers: v })} disabled={ds?.admin_only} />
                Share with managers (they see only their team&apos;s rows){ds?.admin_only ? ' — not available for this dataset' : ''}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Switch checked={scheduleOn} onCheckedChange={setScheduleOn} />
                Email this report on a schedule (CSV attachment)
              </label>
              {scheduleOn && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-slate-50 p-3">
                  <div className="space-y-1.5">
                    <Label>Frequency</Label>
                    <Select value={schedule.frequency} onValueChange={(v) => setSchedule({ ...schedule, frequency: v })}>
                      <SelectTrigger className="h-9 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
                    </Select>
                  </div>
                  {schedule.frequency === 'weekly' && (
                    <div className="space-y-1.5">
                      <Label>Day</Label>
                      <Select value={String(schedule.day_of_week)} onValueChange={(v) => setSchedule({ ...schedule, day_of_week: Number(v) })}>
                        <SelectTrigger className="h-9 bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  {schedule.frequency === 'monthly' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="dom">Day of month</Label>
                      <Input id="dom" type="number" min={1} max={28} className="h-9 bg-white" value={schedule.day_of_month} onChange={(e) => setSchedule({ ...schedule, day_of_month: e.target.value })} />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="time">Time</Label>
                    <Input id="time" type="time" className="h-9 bg-white" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 self-end pb-2">
                    <Switch checked={schedule.enabled} onCheckedChange={(v) => setSchedule({ ...schedule, enabled: v })} /> Active
                  </label>
                  <div className="space-y-1.5 col-span-2 sm:col-span-4">
                    <Label htmlFor="recipients">Recipients</Label>
                    <Input id="recipients" className="h-9 bg-white" placeholder="hr@company.com, ceo@company.com" value={schedule.recipients} onChange={(e) => setSchedule({ ...schedule, recipients: e.target.value })} />
                    <p className="text-[11px] text-slate-500">Times are in the company timezone. Due reports are sent within 15 minutes of the scheduled time.</p>
                  </div>
                </div>
              )}
              <Button onClick={save} disabled={saving || !ds} className="bg-slate-800 hover:bg-slate-900 gap-2 h-9">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {id ? 'Update report' : 'Save report'}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </AnalyticsShell>
  );
};

export default ReportBuilderPage;
