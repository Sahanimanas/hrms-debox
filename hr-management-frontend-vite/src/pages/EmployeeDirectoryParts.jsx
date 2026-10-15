import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Small pieces of the "Employees · Directory" screen (Figma node 14:670).

/** 18px rounded checkbox: line-strong border, yellow when checked. */
export const TableCheckbox = ({ className, ...props }) => (
  <Checkbox
    className={cn(
      'h-[18px] w-[18px] rounded-[5px] border-line-strong bg-surface shadow-none',
      'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-on',
      'data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-brand-on',
      '[&_svg]:h-3 [&_svg]:w-3',
      className,
    )}
    {...props}
  />
);

/** Filter chip "Department: All ⌄" backed by a Radix select. */
export const FilterSelect = ({ label, value, onValueChange, options, className }) => (
  <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger
      className={cn(
        'h-9 w-auto max-w-[240px] gap-1.5 px-3 text-[13px] font-medium leading-[18px] text-ink shadow-none data-[placeholder]:text-ink',
        className,
      )}
    >
      <span className="font-normal text-ink-muted">{label}:</span>
      <SelectValue placeholder="All" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">All</SelectItem>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** Page numbers with ellipses: 1 2 3 … 31 */
const pageList = (page, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
};

const pageBtn = 'inline-flex h-8 min-w-[32px] items-center justify-center rounded-md px-2 text-[13px] font-medium leading-[18px] transition-colors';

/** Table footer: "Showing 1–8 of 248 employees" + pager. */
export const DirectoryPagination = ({ page, totalPages, from, to, total, onChange }) => (
  <div className="flex flex-col gap-3 border-t border-line px-5 py-3.5 sm:flex-row sm:items-center">
    <p className="flex-1 text-[13px] leading-[18px] text-ink-secondary">
      Showing {total ? `${from}–${to}` : 0} of {total} employee{total === 1 ? '' : 's'}
    </p>
    {totalPages > 1 && (
      <nav className="flex flex-wrap items-center gap-2" aria-label="Pagination">
        <button
          type="button"
          className={cn(pageBtn, 'w-8 border border-line text-ink-secondary hover:bg-subtle disabled:opacity-40')}
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageList(page, totalPages).map((p) =>
          typeof p === 'string' ? (
            <span key={p} className={cn(pageBtn, 'text-ink-secondary')}>…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn(pageBtn, p === page ? 'bg-navy text-white' : 'text-ink-secondary hover:bg-subtle')}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={cn(pageBtn, 'w-8 border border-line text-ink-secondary hover:bg-subtle disabled:opacity-40')}
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </nav>
    )}
  </div>
);

/** Row in a popover menu (row actions). */
export const MenuItem = ({ icon, children, className, ...props }) => {
  const Icon = icon;
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink-secondary outline-none transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle',
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  );
};
