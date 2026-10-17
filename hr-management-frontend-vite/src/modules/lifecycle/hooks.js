import { useEffect, useState } from 'react';
import api from '@/lib/api';

/**
 * Employees visible to the current admin / manager (GET /employees). `id` is the
 * employee code, or the uuid / email for legacy rows without one (the lifecycle
 * API accepts any of them); `employee_id` is the code to display ('' if none).
 */
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
