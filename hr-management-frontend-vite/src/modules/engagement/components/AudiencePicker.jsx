// Audience selector: everyone, or one or more departments.
import { useApi, API } from '../lib';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export default function AudiencePicker({ value, onChange, disabled }) {
  const { data: departments, loading } = useApi(`${API}/departments`, { initial: [] });
  const audience = value || { type: 'everyone', departments: [] };

  const toggle = (dept) => {
    const set = new Set(audience.departments);
    if (set.has(dept)) set.delete(dept); else set.add(dept);
    onChange({ type: 'departments', departments: [...set] });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs sm:text-sm">Audience</Label>
      <div className="flex gap-2">
        {[['everyone', 'Everyone'], ['departments', 'Selected departments']].map(([type, label]) => (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ type, departments: type === 'everyone' ? [] : audience.departments })}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm border transition-colors disabled:opacity-50 ${audience.type === type ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {audience.type === 'departments' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-lg border border-slate-200 p-3 max-h-40 overflow-y-auto">
          {loading && <p className="text-xs text-slate-500 col-span-full">Loading departments…</p>}
          {!loading && !departments?.length && <p className="text-xs text-slate-500 col-span-full">No departments found</p>}
          {departments?.map(d => (
            <label key={d} className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 cursor-pointer">
              <Checkbox checked={audience.departments.includes(d)} onCheckedChange={() => toggle(d)} disabled={disabled} />
              <span className="truncate">{d}</span>
            </label>
          ))}
        </div>
      )}
      {audience.type === 'departments' && !audience.departments.length && (
        <p className="text-[11px] text-amber-600">Pick at least one department</p>
      )}
    </div>
  );
}
