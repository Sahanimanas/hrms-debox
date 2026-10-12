import { useEffect, useState } from 'react';
import api from '@/lib/api';

/** Employees visible to the current admin / manager (GET /employees). `id` is the employee code. */
export function useEmployees(enabled = true) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    api.get('/employees')
      .then(r => { if (alive) setList((r.data || []).slice().sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return list;
}
