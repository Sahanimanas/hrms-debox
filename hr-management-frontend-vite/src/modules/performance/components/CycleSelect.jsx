import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Review-cycle picker. `cycles` comes from GET /cycles. */
export default function CycleSelect({ cycles = [], value, onChange }) {
  if (!cycles.length) return null;
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-64 bg-white"><SelectValue placeholder="Choose a review cycle" /></SelectTrigger>
      <SelectContent>
        {cycles.map(c => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}{c.status !== 'active' ? ` (${c.status})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

