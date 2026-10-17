import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Search, ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronRight, ChevronUp, Users, Download, X, Expand, Shrink, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, StatusBadge } from '@/components/ds';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { API, errMsg } from '../lib';
import { PageShell, PageHeader, Loading, Empty, ErrorState, StatTile } from '../components/ui';

// Classic nested ul/li tree: each li draws the horizontal bar above it (::before
// left half, ::after right half + the drop to its card) and each nested ul draws
// the line down from its parent. Colour = the line-strong token.
const LINE = '2px solid #cbd2de';
const GAP = '20px';
const TREE_CSS = `
.org-tree ul { position: relative; display: flex; justify-content: center; padding: ${GAP} 0 0; margin: 0; }
.org-tree li { list-style: none; position: relative; display: flex; flex-direction: column; align-items: center; padding: ${GAP} 6px 0; }
.org-tree li::before, .org-tree li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: ${GAP}; border-top: ${LINE}; }
.org-tree li::after { right: auto; left: 50%; border-left: ${LINE}; margin-left: -1px; }
.org-tree li:first-child::before, .org-tree li:last-child::after { border: 0 none; }
.org-tree li:last-child::before { border-right: ${LINE}; border-radius: 0 8px 0 0; }
.org-tree li:first-child::after { border-radius: 8px 0 0 0; }
.org-tree li:only-child::before, .org-tree li:only-child::after { display: none; }
.org-tree li:only-child { padding-top: 0; }
.org-tree ul ul::before { content: ''; position: absolute; top: 0; left: 50%; margin-left: -1px; width: 0; height: ${GAP}; border-left: ${LINE}; }
.org-tree > ul { padding-top: 0; gap: 40px; align-items: flex-start; }
.org-tree > ul > li { padding-top: 0; }
.org-tree > ul > li::before, .org-tree > ul > li::after { display: none; }
/* A column of leaves: the drop lands on a left-hand spine, each card hangs off it */
.org-tree li.org-stack { align-items: flex-start; }
.org-tree li.org-stack::before { right: auto; left: 0; width: 23px; }
.org-tree li.org-stack::after { left: 22px; width: calc(100% - 22px); }
.org-tree li.org-stack:only-child { padding-top: ${GAP}; }
.org-tree li.org-stack:only-child::before { display: block; left: 21px; width: calc(50% - 21px); border: 0; border-top: ${LINE}; border-radius: 0; }
.org-tree li.org-stack:only-child::after { display: block; border-top: 0; border-radius: 0; }
.org-stack-list { display: flex; flex-direction: column; gap: 8px; margin-left: 15px; padding-left: 12px; }
.org-stack-item { position: relative; }
.org-stack-item::before { content: ''; position: absolute; left: -12px; top: 50%; width: 12px; border-top: ${LINE}; }
.org-stack-item::after { content: ''; position: absolute; left: -12px; top: -8px; height: calc(100% + 8px); border-left: ${LINE}; }
.org-stack-item:last-child::after { height: calc(50% + 9px); }
`;

// Leaves under one manager are stacked vertically once there are more than this many
const STACK_LEAVES_OVER = 3;
// Small orgs open fully; larger ones open the first levels only
const EXPAND_ALL_UP_TO = 60;
const OPEN_LEVELS = 2;
const ROLE_RANK = { admin: 0, manager: 1 };

const lower = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);

/**
 * Build the reporting tree from the org-chart nodes. A person's manager is
 * `manager_uid` (resolved by the API), falling back to `manager_email`
 * (case-insensitive). Self-references, unknown managers and cycles
 * (A → B → A) all end up as roots.
 */
const buildTree = (nodes) => {
  const byUid = new Map(nodes.map(n => [n.uid, n]));
  const byEmail = new Map();
  nodes.forEach(n => { const e = lower(n.email); if (e && !byEmail.has(e)) byEmail.set(e, n); });

  const parentOf = new Map();
  for (const n of nodes) {
    const m = (n.manager_uid && byUid.get(n.manager_uid)) || byEmail.get(lower(n.manager_email));
    parentOf.set(n.uid, m && m.uid !== n.uid ? m.uid : null);
  }
  // Break cycles: walk up from each person; re-entering the current path means a loop
  const state = new Map(); // 1 = on the current path, 2 = done
  for (const n of nodes) {
    const path = [];
    let cur = n.uid;
    while (cur && !state.has(cur)) { state.set(cur, 1); path.push(cur); cur = parentOf.get(cur); }
    if (cur && state.get(cur) === 1) parentOf.set(cur, null);
    path.forEach(u => state.set(u, 2));
  }

  const children = new Map();
  for (const n of nodes) {
    const p = parentOf.get(n.uid);
    if (!p) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }

  const teamSize = new Map();
  const depthOf = new Map();
  const size = (uid) => {
    if (teamSize.has(uid)) return teamSize.get(uid);
    const s = (children.get(uid) || []).reduce((t, c) => t + 1 + size(c.uid), 0);
    teamSize.set(uid, s);
    return s;
  };
  nodes.forEach(n => size(n.uid));

  const byTeam = (a, b) => (teamSize.get(b.uid) - teamSize.get(a.uid))
    || ((ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9))
    || (a.full_name || '').localeCompare(b.full_name || '');
  for (const list of children.values()) list.sort(byTeam);

  const roots = nodes.filter(n => !parentOf.get(n.uid));
  const treeRoots = roots.filter(n => children.has(n.uid)).sort(byTeam);
  const loose = roots.filter(n => !children.has(n.uid)).sort(byTeam);

  let maxDepth = 0;
  const walk = (uid, d) => {
    depthOf.set(uid, d);
    maxDepth = Math.max(maxDepth, d);
    (children.get(uid) || []).forEach(c => walk(c.uid, d + 1));
  };
  treeRoots.forEach(r => walk(r.uid, 1));
  loose.forEach(r => depthOf.set(r.uid, 1));

  return { byUid, parentOf, children, teamSize, depthOf, treeRoots, loose, maxDepth };
};

const matchesQuery = (n, q) => [n.full_name, n.designation, n.department, n.employee_id, n.email]
  .some(v => (v || '').toLowerCase().includes(q));

const PersonCard = ({ node, reports, team, expanded, onToggle, selected, matched, root, compact }) => (
  <div
    id={`org-${node.uid}`}
    className={cn(
      'relative rounded-lg border bg-surface text-left shadow-xs transition-shadow',
      compact ? 'w-44 sm:w-52 p-2.5' : 'w-44 sm:w-56 p-3',
      root && 'border-t-[3px] border-t-brand',
      selected ? 'border-brand ring-2 ring-brand bg-brand-subtle shadow-sm'
        : matched ? 'border-brand ring-1 ring-brand/60 bg-brand-subtle'
          : 'border-line hover:shadow-sm',
      reports > 0 && 'mb-3'
    )}
  >
    <div className="flex items-center gap-2.5">
      <Avatar name={node.full_name} src={node.profile_picture_url} size={compact ? 'md' : 'lg'} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink truncate" title={node.full_name}>{node.full_name}</p>
        <p className="text-[11px] text-ink-secondary truncate" title={node.designation || ''}>{node.designation || '—'}</p>
        <p className="text-[11px] text-ink-muted truncate" title={node.department || ''}>{node.department || '—'}</p>
      </div>
    </div>
    {node.employment_status && node.employment_status !== 'active' && (
      <StatusBadge status={node.employment_status} className="absolute top-1.5 right-1.5 px-1.5 py-0 text-[9px]" dot={false} />
    )}
    {reports > 0 && (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? `Hide ${team} in team` : `Show ${reports} direct report${reports === 1 ? '' : 's'}`}
        className={cn(
          'absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap',
          expanded ? 'border-line bg-surface text-ink-secondary hover:bg-subtle' : 'border-brand bg-brand-subtle text-brand-text hover:bg-brand/20'
        )}
      >
        {expanded
          ? <><Users className="w-3 h-3" />{reports}<ChevronUp className="w-3 h-3" /></>
          : <>+{team}<ChevronDown className="w-3 h-3" /></>}
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
  const [looseOpen, setLooseOpen] = useState(false);

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const { byUid, parentOf, children, teamSize, depthOf, treeRoots, loose, maxDepth } = tree;
  const managerUids = useMemo(() => nodes.filter(n => children.has(n.uid)).map(n => n.uid), [nodes, children]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${API}/org-chart`);
      const list = r.data || [];
      setNodes(list);
      const t = buildTree(list);
      const open = list.filter(n => t.children.has(n.uid) && (list.length <= EXPAND_ALL_UP_TO || t.depthOf.get(n.uid) <= OPEN_LEVELS));
      setExpanded(new Set(open.map(n => n.uid)));
      setLooseOpen(t.treeRoots.length === 0);
    } catch (e) {
      setError(errMsg(e, 'Failed to load org chart'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const ancestorsOf = useCallback((uid) => {
    const out = [];
    const guard = new Set([uid]);
    let p = parentOf.get(uid);
    while (p && !guard.has(p)) { guard.add(p); out.push(p); p = parentOf.get(p); }
    return out;
  }, [parentOf]);

  const q = query.trim().toLowerCase();
  const matchedUids = useMemo(
    () => (q.length < 2 ? new Set() : new Set(nodes.filter(n => matchesQuery(n, q)).map(n => n.uid))),
    [nodes, q]
  );
  const suggestions = useMemo(() => nodes.filter(n => matchedUids.has(n.uid)).slice(0, 8), [nodes, matchedUids]);

  // Searching opens the branches that lead to every match
  useEffect(() => {
    if (!matchedUids.size) return;
    setExpanded(prev => {
      const next = new Set(prev);
      matchedUids.forEach(uid => ancestorsOf(uid).forEach(a => next.add(a)));
      return next.size === prev.size ? prev : next;
    });
    if (loose.some(n => matchedUids.has(n.uid))) setLooseOpen(true);
  }, [matchedUids, ancestorsOf, loose]);

  useEffect(() => {
    if (!highlight) return undefined;
    const id = requestAnimationFrame(() => {
      document.getElementById(`org-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlight, expanded, looseOpen]);

  const reveal = (uid) => {
    setExpanded(prev => new Set([...prev, ...ancestorsOf(uid)]));
    if (loose.some(n => n.uid === uid)) setLooseOpen(true);
    setHighlight(uid);
    setQuery('');
  };

  const toggle = (uid) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const card = (node, opts = {}) => {
    const reports = (children.get(node.uid) || []).length;
    return (
      <PersonCard
        node={node}
        reports={reports}
        team={teamSize.get(node.uid) || 0}
        expanded={expanded.has(node.uid)}
        onToggle={() => toggle(node.uid)}
        selected={highlight === node.uid}
        matched={matchedUids.has(node.uid)}
        {...opts}
      />
    );
  };

  const renderNode = (node, depth = 0) => {
    const kids = children.get(node.uid) || [];
    const open = expanded.has(node.uid);
    const leaves = kids.filter(k => !children.has(k.uid));
    const branches = kids.filter(k => children.has(k.uid));
    const stackLeaves = leaves.length > STACK_LEAVES_OVER;
    return (
      <li key={node.uid}>
        {card(node, { root: depth === 0 })}
        {open && kids.length > 0 && depth < 40 && (
          <ul>
            {branches.map(k => renderNode(k, depth + 1))}
            {stackLeaves ? (
              <li className="org-stack">
                <div className="org-stack-list">
                  {leaves.map(k => <div key={k.uid} className="org-stack-item">{card(k, { compact: true })}</div>)}
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
    { label: 'Manager', value: r => byUid.get(parentOf.get(r.uid))?.full_name || '' },
    { label: 'Level', value: r => depthOf.get(r.uid) || 1 },
    { label: 'Direct reports', value: r => (children.get(r.uid) || []).length },
    { label: 'Total team', value: r => teamSize.get(r.uid) || 0 },
  ]);

  const departments = new Set(nodes.map(n => n.department).filter(Boolean)).size;

  return (
    <PageShell>
      <style>{TREE_CSS}</style>
      <PageHeader icon={Network} title="Org Chart" subtitle="Who reports to whom across the organisation">
        <Button variant="outline" className="gap-2 w-full sm:w-auto" onClick={doExport} disabled={!nodes.length}><Download className="w-4 h-4" />Export CSV</Button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatTile label="People" value={nodes.length} icon={Users} />
        <StatTile label="Managers" value={managerUids.length} icon={Network} tone="purple" />
        <StatTile label="Departments" value={departments} icon={Maximize2} tone="blue" />
      </div>

      <div className="min-w-0 rounded-lg border border-line bg-surface shadow-xs">
        <div className="p-3 sm:p-4 border-b border-line flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <Input
              className="pl-9"
              placeholder="Find a person, role or department"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && suggestions[0]) reveal(suggestions[0].uid); if (e.key === 'Escape') setQuery(''); }}
            />
            {q.length >= 2 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-surface rounded-md border border-line shadow-sm max-h-72 overflow-y-auto">
                {suggestions.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-ink-muted">No one matches &ldquo;{query.trim()}&rdquo;</p>
                ) : suggestions.map(m => (
                  <button key={m.uid} type="button" onClick={() => reveal(m.uid)} className="w-full text-left px-3 py-2 hover:bg-subtle flex items-center gap-2">
                    <Avatar name={m.full_name} src={m.profile_picture_url} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">{m.full_name}</p>
                      <p className="text-[11px] text-ink-muted truncate">
                        {m.designation || '—'} · {m.department || '—'}
                        {parentOf.get(m.uid) && <> · reports to {byUid.get(parentOf.get(m.uid))?.full_name}</>}
                      </p>
                    </div>
                  </button>
                ))}
                {matchedUids.size > suggestions.length && (
                  <p className="px-3 py-1.5 text-[11px] text-ink-muted border-t border-line">{matchedUids.size - suggestions.length} more highlighted in the chart</p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {highlight && <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={() => setHighlight(null)}><X className="w-3.5 h-3.5" />Clear</Button>}
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Expand all" title="Expand all" onClick={() => setExpanded(new Set(managerUids))}><Expand className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Collapse all" title="Collapse all" onClick={() => setExpanded(new Set())}><Shrink className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(z => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}><ZoomOut className="w-4 h-4" /></Button>
            <button type="button" className="text-xs w-12 text-center text-ink-secondary" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(z => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))}><ZoomIn className="w-4 h-4" /></Button>
          </div>
        </div>

        {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : nodes.length === 0 ? (
          <Empty icon={Network} title="No employees yet" />
        ) : (
          <>
            {treeRoots.length > 0 ? (
              <>
                <p className="px-3 sm:px-4 pt-3 text-xs text-ink-muted">
                  {treeRoots.length} reporting line{treeRoots.length === 1 ? '' : 's'} · {maxDepth} level{maxDepth === 1 ? '' : 's'} deep
                </p>
                <div className="overflow-auto overscroll-contain p-4 sm:p-6 max-h-[70vh]">
                  <div className="org-tree w-max min-w-full" style={{ zoom }}>
                    <ul>{treeRoots.map(r => renderNode(r))}</ul>
                  </div>
                </div>
              </>
            ) : (
              <Empty icon={Network} title="No reporting lines yet" hint="Set each employee's manager to build the chart." />
            )}

            {loose.length > 0 && (
              <div className="border-t border-line">
                <button
                  type="button"
                  onClick={() => setLooseOpen(o => !o)}
                  aria-expanded={looseOpen}
                  className="w-full flex items-center gap-2 px-3 sm:px-4 py-3 text-left hover:bg-subtle rounded-b-lg"
                >
                  {looseOpen ? <ChevronDown className="w-4 h-4 text-ink-muted" /> : <ChevronRight className="w-4 h-4 text-ink-muted" />}
                  <UserMinus className="w-4 h-4 text-ink-secondary" />
                  <span className="text-sm font-semibold text-ink">Not in a reporting line</span>
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-ink-secondary">{loose.length}</span>
                  <span className="hidden sm:inline text-xs text-ink-muted truncate">No manager and no direct reports</span>
                </button>
                {looseOpen && (
                  <div className="px-3 sm:px-4 pb-4 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2 justify-items-center sm:justify-items-start">
                    {loose.map(n => <React.Fragment key={n.uid}>{card(n, { compact: true })}</React.Fragment>)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Reporting lines come from each employee&apos;s manager. People without a manager (or whose manager has left) head their own line at the top; anyone with neither a manager nor direct reports is listed under &ldquo;Not in a reporting line&rdquo;.
      </p>
    </PageShell>
  );
};

export default OrgChartPage;
