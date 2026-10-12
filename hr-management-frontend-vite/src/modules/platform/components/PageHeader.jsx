import React from 'react';

/** Page header in the style of MyAttendancePage: dark icon tile + title + subtitle + actions. */
const PageHeader = ({ icon, title, subtitle, children }) => {
  const Icon = icon;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg shrink-0">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 truncate" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            {title}
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
};

export const PageShell = ({ children }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
    <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">{children}</div>
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
