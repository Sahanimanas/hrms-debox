import React from 'react';
import { CalendarRange } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MONTH_PRESETS, DAY_PRESETS, monthPresetRange, dayPresetRange } from '../lib';

/**
 * One filter row above everything it scopes: date range first (presets, then
 * a custom range), then department / organization.
 *
 * value: { preset, from, to, department, organization_id }
 * mode: 'month' (YYYY-MM) or 'day' (YYYY-MM-DD)
 */
const FilterBar = ({ mode = 'month', value, onChange, options, showOrganization = true }) => {
  const presets = mode === 'month' ? MONTH_PRESETS : DAY_PRESETS;
  const rangeFor = mode === 'month' ? monthPresetRange : dayPresetRange;

  const setPreset = (preset) => {
    if (preset === 'custom') return onChange({ ...value, preset });
    onChange({ ...value, preset, ...rangeFor(preset) });
  };

  return (
    <div className="flex flex-col lg:flex-row lg:items-end gap-2 sm:gap-3 rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wider lg:pb-2.5">
        <CalendarRange className="w-4 h-4" /> Filters
      </div>
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 flex-1">
        <div className="col-span-2 sm:w-44">
          <Select value={value.preset} onValueChange={setPreset}>
            <SelectTrigger className="h-9 text-sm" aria-label="Date range"><SelectValue /></SelectTrigger>
            <SelectContent>
              {presets.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.preset === 'custom' && (
          <>
            <Input
              type={mode === 'month' ? 'month' : 'date'}
              aria-label="From"
              className="h-9 text-sm sm:w-40"
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
            <Input
              type={mode === 'month' ? 'month' : 'date'}
              aria-label="To"
              className="h-9 text-sm sm:w-40"
              value={value.to}
              min={value.from}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </>
        )}
        <div className="sm:w-48">
          <Select value={value.department || 'all'} onValueChange={(v) => onChange({ ...value, department: v })}>
            <SelectTrigger className="h-9 text-sm" aria-label="Department"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {options.departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {showOrganization && options.organizations.length > 0 && (
          <div className="sm:w-48">
            <Select value={value.organization_id || 'all'} onValueChange={(v) => onChange({ ...value, organization_id: v })}>
              <SelectTrigger className="h-9 text-sm" aria-label="Organization"><SelectValue placeholder="All organizations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organizations</SelectItem>
                {options.organizations.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilterBar;
