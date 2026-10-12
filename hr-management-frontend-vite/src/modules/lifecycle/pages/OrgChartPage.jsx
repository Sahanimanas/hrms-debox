import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Search, ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronUp, Users, Download, X, Expand, Shrink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg, initials, avatarColor } from '../lib';
import { PageShell, PageHeader, Loading, Empty, ErrorState, StatTile } from '../components/ui';

const TREE_CSS = `
.org-tree ul { position: relative; display: flex; justify-content: center; padding-top: 22px; margin: 0; }
.org-tree li { list-style: none; position: relative; padding: 22px 6px 0; display: flex; flex-direction: column; align-items: center; }
.org-tree li::before, .org-tree li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 22px; border-top: 2px solid #cbd5e1; }
.org-tree li::after { right: auto; left: 50%; border-left: 2px solid #cbd5e1; }
.org-tree li:only-child::before, .org-tree li:only-child::after { display: none; }
.org-tree li:only-child { padding-top: 0; }
.org-tree li:first-child::before, .org-tree li:last-child::after { border: 0 none; }
.org-tree li:last-child::before { border-right: 2px solid #cbd5e1; border-radius: 0 6px 0 0; }
.org-tree li:first-child::after { border-radius: 6px 0 0 0; }
.org-tree ul ul::before { content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 22px; border-left: 2px solid #cbd5e1; }
.org-tree > ul { padding-top: 0; gap: 28px; align-items: flex-start; }
.org-tree > ul > li { padding-top: 0; }
.org-tree > ul > li::before, .org-tree > ul > li::after { display: none; }
`;

// Leaves under one manager are stacked vertically once there are more than this many
const STACK_LEAVES_OVER = 3;

const PersonCard = ({ node, count, expanded, onToggle, highlighted, compact }) => (
  <div
    id={`org-${node.uid}`}
    className={`relative bg-white rounded-xl border shadow-sm ${compact ? 'w-52' : 'w-56'} p-3 text-left transition-shadow ${highlighted ? 'ring-4 ring-yellow-400 border-yellow-400 shadow-lg' : 'border-slate-200 hover:shadow-md'}`}
  >
    <div className="flex items-center gap-2.5">
      {node.profile_picture_url ? (
        <img src={node.profile_picture_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div className={`w-10 h-10 rounded-full ${avatarColor(node.full_name)} flex items-center justify-center text-white text-sm font-semibold shrink-0`}>{initials(node.full_name)}</div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate" title={node.full_name}>{node.full_name}</p>
        <p className="text-[11px] text-slate-600 truncate" title={node.designation}>{node.designation || '—'}</p>
        <p className="text-[11px] text-slate-400 truncate">{node.department || '—'}</p>
      </div>
    </div>
    {node.employment_status && node.employment_status !== 'active' && (
      <span className="absolute top-1.5 right-2 text-[9px] uppercase tracking-wide text-amber-600">{node.employment_status}</span>
    )}
    {count > 0 && (
      <button
        type="button"
        onClick={onToggle}
        className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-md py-1"
        aria-expanded={expanded}
      >
        <Users className="w-3 h-3" />{count} report{count === 1 ? '' : 's'}
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
    )}
  </div>
);

const OrgChartPage = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(null);
  const [zoom, setZoom] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/org-chart`);
      const list = r.data || [];
      setNodes(list);
      // Start with roots and their direct reports open
      setExpanded(new Set(list.filter(n => !n.manager_uid).map(n => n.uid)));
    } catch (e) {
      setError(errMsg(e, 'Failed to load org chart'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { byUid, children, roots } = useMemo(() => {
    const byUid = new Map(nodes.map(n => [n.uid, n]));
    const children = new Map();
    for (const n of nodes) {
      if (!n.manager_uid) continue;
      if (!children.has(n.manager_uid)) children.set(n.manager_uid, []);
      children.get(n.manager_uid).push(n);
    }
    const sortFn = (a, b) => (children.get(b.uid)?.length || 0) - (children.get(a.uid)?.length || 0) || a.full_name.localeCompare(b.full_name);
    for (const list of children.values()) list.sort(sortFn);
    const roots = nodes.filter(n => !n.manager_uid).sort(sortFn);
    return { byUid, children, roots };
  }, [nodes]);

  // Team size (all levels) per person
  const teamSize = useMemo(() => {
    const memo = new Map();
    const size = (uid, seen = new Set()) => {
      if (memo.has(uid)) return memo.get(uid);
      if (seen.has(uid)) return 0;
      seen.add(uid);
      const s = (children.get(uid) || []).reduce((t, c) => t + 1 + size(c.uid, seen), 0);
      memo.set(uid, s);
      return s;
    };
    nodes.forEach(n => size(n.uid));
    return memo;
  }, [nodes, children]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return nodes.filter(n => n.full_name.toLowerCase().includes(q) || (n.designation || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q) || (n.employee_id || '').toLowerCase().includes(q)).slice(0, 8);
  }, [nodes, query]);

  useEffect(() => {
    if (!highlight) return undefined;
    const id = requestAnimationFrame(() => {
      document.getElementById(`org-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlight, expanded]);

  const reveal = (uid) => {
    const next = new Set(expanded);
    let cur = byUid.get(uid);
    const guard = new Set();
    while (cur?.manager_uid && !guard.has(cur.uid)) {
      guard.add(cur.uid);
      next.add(cur.manager_uid);
      cur = byUid.get(cur.manager_uid);
    }
    setExpanded(next);
    setHighlight(uid);
    setQuery('');
  };

  const toggle = (uid) => {
    const next = new Set(expanded);
    next.has(uid) ? next.delete(uid) : next.add(uid);
    setExpanded(next);
  };

  const renderNode = (node, depth = 0) => {
    const kids = children.get(node.uid) || [];
    const open = expanded.has(node.uid);
    const leaves = kids.filter(k => !(children.get(k.uid) || []).length);
    const branches = kids.filter(k => (children.get(k.uid) || []).length);
    const stackLeaves = leaves.length > STACK_LEAVES_OVER;
    return (
      <li key={node.uid}>
        <PersonCard node={node} count={kids.length} expanded={open} onToggle={() => toggle(node.uid)} highlighted={highlight === node.uid} />
        {open && kids.length > 0 && depth < 40 && (
          <ul>
            {branches.map(k => renderNode(k, depth + 1))}
            {stackLeaves ? (
              <li>
                <div className="flex flex-col gap-2 border-l-2 border-slate-300 pl-3 ml-4 self-start">
                  {leaves.map(k => (
                    <PersonCard key={k.uid} node={k} count={0} highlighted={highlight === k.uid} compact />
                  ))}
                </div>
              </li>
            ) : leaves.map(k => renderNode(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const doExport = () => exportCsv('org-chart', nodes, [
    { key: 'full_name', label: 'Name' },
    { key: 'employee_id', label: 'Employee ID' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { label: 'Manager', value: r => byUid.get(r.manager_uid)?.full_name || '' },
    { key: 'direct_reports', label: 'Direct reports' },
    { label: 'Total team', value: r => teamSize.get(r.uid) || 0 },
  ]);

  const departments = new Set(nodes.map(n => n.department).filter(Boolean)).size;
  const managers = nodes.filter(n => n.direct_reports > 0).length;

  return (
    <PageShell>
      <style>{TREE_CSS}</style>
      <PageHeader icon={Network} title="Org Chart" subtitle="Who reports to whom across the organisation">
        <Button variant="outline" className="gap-2 w-full sm:w-auto" onClick={doExport} disabled={!nodes.length}><Download className="w-4 h-4" />Export CSV</Button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="People" value={nodes.length} icon={Users} />
        <StatTile label="Managers" value={managers} icon={Network} tone="purple" />
        <StatTile label="Departments" value={departments} icon={Maximize2} tone="blue" />
      </div>

      <div className="bg-white rounded-xl shadow-md border-0">
        <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Find a person, role or department" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg max-h-72 overflow-y-auto">
                {matches.map(m => (
                  <button key={m.uid} type="button" onClick={() => reveal(m.uid)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full ${avatarColor(m.full_name)} flex items-center justify-center text-white text-[10px] font-semibold shrink-0`}>{initials(m.full_name)}</div>
                    <div className="min-w-0"><p className="text-sm text-slate-900 truncate">{m.full_name}</p><p className="text-[11px] text-slate-500 truncate">{m.designation || '—'} · {m.department || '—'}</p></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {highlight && <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={() => setHighlight(null)}><X className="w-3.5 h-3.5" />Clear</Button>}
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Expand all" title="Expand all" onClick={() => setExpanded(new Set(nodes.map(n => n.uid)))}><Expand className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Collapse all" title="Collapse all" onClick={() => setExpanded(new Set())}><Shrink className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}><ZoomOut className="w-4 h-4" /></Button>
            <button type="button" className="text-xs w-12 text-center text-slate-600" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))}><ZoomIn className="w-4 h-4" /></Button>
          </div>
        </div>
        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : nodes.length === 0 ? (
          <Empty icon={Network} title="No employees yet" />
        ) : (
          <div className="overflow-auto p-4 sm:p-6 max-h-[75vh] bg-slate-50/60 rounded-b-xl">
            <div className="org-tree inline-block min-w-full" style={{ zoom }}>
              <ul>{roots.map(r => renderNode(r))}</ul>
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">Reporting lines come from each employee&apos;s manager. People without a manager (or whose manager has left) appear at the top.</p>
    </PageShell>
  );
};

export default OrgChartPage;
