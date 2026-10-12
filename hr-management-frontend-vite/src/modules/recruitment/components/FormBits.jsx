import React from 'react';
import { Upload } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RESUME_ACCEPT } from '../lib';

export const Field = ({ id, label, hint, error, className = '', children }) => (
  <div className={`space-y-1.5 ${className}`}>
    {label && <Label htmlFor={id} className="text-xs sm:text-sm">{label}</Label>}
    {children}
    {hint && !error && <p className="text-[11px] text-slate-500">{hint}</p>}
    {error && <p className="text-xs text-red-600">{error}</p>}
  </div>
);

/** Native select styled like the shadcn inputs (works well on mobile). */
export const NativeSelect = ({ id, value, onChange, options, placeholder, className = '', ...rest }) => (
  <select
    id={id}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value)}
    className={`flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    {...rest}
  >
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map(o => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

export const FilePicker = ({ id, file, onChange, label = 'Choose a resume (PDF, DOC, DOCX · max 5 MB)' }) => (
  <label
    htmlFor={id}
    className="flex items-center gap-2 h-10 px-3 rounded-md border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:border-slate-500 focus-within:ring-2 focus-within:ring-slate-300"
  >
    <Upload className="w-4 h-4 shrink-0" />
    <span className="truncate">{file ? file.name : label}</span>
    <input id={id} type="file" accept={RESUME_ACCEPT} className="sr-only" onChange={(e) => onChange(e.target.files?.[0] || null)} />
  </label>
);
