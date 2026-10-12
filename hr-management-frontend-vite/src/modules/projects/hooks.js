// Data hooks for Xeno PM. People and meta are cached for the session.
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { API, errorText } from './lib';

const cache = { people: null, meta: null };
const inflight = {};

const cached = (key, url) => {
  if (cache[key]) return Promise.resolve(cache[key]);
  if (!inflight[key]) {
    inflight[key] = api.get(url)
      .then(r => { cache[key] = r.data; return r.data; })
      .finally(() => { delete inflight[key]; });
  }
  return inflight[key];
};

/** Active employees for pickers: [{ email, name, designation, department, picture }]. */
export function usePeople() {
  const [people, setPeople] = useState(cache.people || []);
  useEffect(() => {
    let alive = true;
    cached('people', `${API}/people`).then(d => alive && setPeople(d)).catch(() => {});
    return () => { alive = false; };
  }, []);
  return people;
}

/** Templates, task types, priorities and whether the user may create projects. */
export function usePmMeta() {
  const [meta, setMeta] = useState(cache.meta);
  useEffect(() => {
    let alive = true;
    cached('meta', `${API}/meta`).then(d => alive && setMeta(d)).catch(() => {});
    return () => { alive = false; };
  }, []);
  return meta;
}

/** Generic loader: { data, loading, error, reload, setData }. */
export function useLoad(url, fallback = 'Failed to load') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!url) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const r = await api.get(url);
      setData(r.data);
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setLoading(false);
    }
  }, [url, fallback]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload, setData };
}
