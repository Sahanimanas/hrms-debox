import { useEffect, useState } from 'react';
import api from '@/lib/api';

/** Departments / organizations the current user may filter analytics by. */
export function useFilterOptions() {
  const [options, setOptions] = useState({ departments: [], organizations: [], designations: [], email_configured: undefined });
  useEffect(() => {
    let cancelled = false;
    api.get('/v2/analytics/filters')
      .then((r) => { if (!cancelled) setOptions(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return options;
}
