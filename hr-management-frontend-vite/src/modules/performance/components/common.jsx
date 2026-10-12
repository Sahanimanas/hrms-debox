// Shared UI pieces for the performance module (page header, states, pills, pickers).
import React, { useMemo, useState } from 'react';
import { Download, AlertTriangle, Inbox, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TONES } from '../lib';

export function PageShell({ icon, title, subtitle, actions, children }) {
  const Icon = icon;
  return (
    <div className="p-3 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-800 rounded-xl flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 truncate" style={{ fontFamily: 'Plus Jakarta Sans' }}>{title}</h1>
              {subtitle && <p className="text-xs sm:text-sm text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionCard({ icon, title, actions, children, className = '', bodyClassName = 'p-0' }) {
  const Icon = icon;
  return (
    <Card className={`border-0 shadow-md ${className}`}>
      {(title || actions) && (
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />}
              {title}
            </CardTitle>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </CardHeader>
      )}
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}

export function LoadingState({ text = 'Loading…' }) {
  return (
    <div className="text-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

export function EmptyState({ icon = Inbox, text, children }) {
  const Icon = icon;
  return (
    <div className="text-center py-12 px-4 text-slate-500">
      <Icon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
      <p className="text-sm">{text}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="text-center py-10 px-4">
      <AlertTriangle className="w-9 h-9 mx-auto mb-2 text-rose-400" />
      <p className="text-sm text-slate-600">{message || 'Failed to load'}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Loading / error / empty switch for a useApi() result. */
export function DataState({ state, empty, emptyText, emptyIcon, children }) {
  if (state.loading && !state.data) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (empty) return <EmptyState icon={emptyIcon} text={emptyText} />;
  return children;
}

export function Pill({ map, value, tone, children, className = '' }) {
  const entry = map ? map[value] : null;
  const t = tone || entry?.tone || 'slate';
  return (
    <Badge className={`${TONES[t]} hover:opacity-90 text-[10px] sm:text-xs font-medium whitespace-nowrap ${className}`}>
      {children || entry?.label || value || '—'}
    </Badge>
  );
}

export function ExportButton({ onClick, disabled }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} className="gap-1.5">
      <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export CSV</span><span className="sm:hidden">CSV</span>
    </Button>
  );
}

export function StatTile({ label, value, icon, tone = 'slate' }) {
  const Icon = icon;
  const toneBg = { slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', purple: 'bg-purple-50 text-purple-600', blue: 'bg-blue-50 text-blue-600' };
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
          <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        </div>
        {Icon && (
          <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${toneBg[tone]}`}>
            <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <Progress value={v} className="h-2 flex-1" />
      <span className="text-xs text-slate-600 tabular-nums w-10 text-right">{Math.round(v)}%</span>
    </div>
  );
}

/** Single select over people [{ email, full_name, department }] */
export function PersonSelect({ people = [], value, onChange, placeholder = 'Select a person', id }) {
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {people.map(p => (
          <SelectItem key={p.email} value={p.email}>
            {p.full_name}{p.department ? <span className="text-slate-400"> · {p.department}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Searchable checkbox list for choosing several people. */
export function PeoplePicker({ people = [], selected = [], onChange, max }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? people.filter(p => `${p.full_name} ${p.email} ${p.department || ''}`.toLowerCase().includes(term)) : people;
  }, [people, q]);
  const toggle = (email) => {
    if (selected.includes(email)) onChange(selected.filter(e => e !== email));
    else if (!max || selected.length < max) onChange([...selected, email]);
  };
  return (
    <div className="border border-slate-200 rounded-lg">
      <div className="relative border-b border-slate-100">
        <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="border-0 pl-8 focus-visible:ring-0 shadow-none" />
      </div>
      <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
        {filtered.length === 0 && <p className="text-xs text-slate-400 p-3">No matches</p>}
        {filtered.map(p => (
          <label key={p.email} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
            <Checkbox checked={selected.includes(p.email)} onCheckedChange={() => toggle(p.email)} />
            <span className="truncate">{p.full_name}</span>
            <span className="text-xs text-slate-400 truncate ml-auto">{p.department}</span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 px-3 py-1.5 border-t border-slate-100">{selected.length} selected{max ? ` (max ${max})` : ''}</p>
    </div>
  );
}

/** 1–5 rating select with labels from the configured scale. */
export function RatingSelect({ scale = [], value, onChange, disabled, placeholder = 'Rate' }) {
  return (
    <Select value={value ? String(value) : ''} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {(scale.length ? scale : [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) }))).map(s => (
          <SelectItem key={s.value} value={String(s.value)}>{s.value} — {s.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SimpleSelect({ value, onChange, options, placeholder, className = '', id }) {
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Responsive table wrapper with the module's header style. */
export function DataTable({ columns, rows, rowKey = 'id', onRowClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
          <tr>
            {columns.map(c => (
              <th key={c.key} className={`text-left font-medium px-3 sm:px-4 py-3 whitespace-nowrap ${c.hideOnMobile ? 'hidden md:table-cell' : ''} ${c.className || ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(row => (
            <tr key={row[rowKey]} className={`hover:bg-slate-50 ${onRowClick ? 'cursor-pointer' : ''}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map(c => (
                <td key={c.key} className={`px-3 sm:px-4 py-3 align-top ${c.hideOnMobile ? 'hidden md:table-cell' : ''} ${c.className || ''}`}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
