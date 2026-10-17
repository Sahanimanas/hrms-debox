import React from 'react';

/**
 * Page header (Figma "Page header"): 28px title, 15px subtitle, actions on the right.
 * `icon` is still accepted from older callers; the redesign no longer shows an icon tile.
 */
const PageHeader = ({ title, subtitle, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
    <div className="min-w-0 space-y-1">
      <h1 className="font-display text-2xl sm:text-[28px] sm:leading-9 font-bold tracking-[-0.02em] text-ink truncate">
        {title}
      </h1>
      {subtitle && <p className="text-sm sm:text-[15px] sm:leading-6 text-ink-secondary">{subtitle}</p>}
    </div>
    {children && <div className="flex flex-wrap gap-3">{children}</div>}
  </div>
);

export const PageShell = ({ children }) => (
  <div className="min-h-full bg-canvas p-4 sm:p-6 lg:p-8">
    <div className="w-full space-y-6">{children}</div>
  </div>
);

export const LoadingBlock = ({ label = 'Loading…' }) => (
  <div className="text-center py-12">
    <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3"></div>
    <p className="text-sm text-slate-500">{label}</p>
  </div>
);

export const EmptyBlock = ({ icon, title, children }) => {
  const Icon = icon;
  return (
    <div className="text-center py-12 px-4 text-slate-500">
      {Icon && <Icon className="w-10 h-10 mx-auto mb-3 text-slate-300" />}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {children && <div className="text-xs mt-1">{children}</div>}
    </div>
  );
};

export const ErrorBlock = ({ message, onRetry }) => (
  <div className="text-center py-10 px-4">
    <p className="text-sm text-red-600">{message}</p>
    {onRetry && (
      <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-slate-700 underline">
        Try again
      </button>
    )}
  </div>
);

export default PageHeader;
