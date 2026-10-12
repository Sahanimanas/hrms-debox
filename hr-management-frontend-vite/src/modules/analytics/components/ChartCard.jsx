import React, { useState } from 'react';
import { Download, Table2, BarChart3, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { exportCsv } from '@/lib/exportCsv';

/**
 * A chart with its table-view twin and a "download CSV" of exactly the data
 * plotted. columns: [{ key, label, format?(value, row) }].
 */
const ChartCard = ({
  title,
  subtitle,
  rows = [],
  columns = [],
  filename,
  onServerCsv,
  loading = false,
  emptyText = 'No data for the selected filters',
  defaultView = 'chart',
  className = '',
  children,
}) => {
  const [view, setView] = useState(defaultView);
  const [downloading, setDownloading] = useState(false);
  const hasChart = !!children;
  const showTable = view === 'table' || !hasChart;

  const download = async () => {
    if (onServerCsv) {
      setDownloading(true);
      try {
        await onServerCsv();
      } catch {
        toast.error('Export failed');
      } finally {
        setDownloading(false);
      }
      return;
    }
    if (!rows.length) return toast.error('Nothing to export');
    exportCsv(filename || title, rows, columns.map(c => ({ key: c.key, label: c.label })));
  };

  return (
    <Card className={`border-0 shadow-md ${className}`}>
      <CardHeader className="border-b border-slate-100 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm sm:text-base text-slate-900">{title}</CardTitle>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex gap-1 shrink-0">
            {hasChart && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setView(showTable ? 'chart' : 'table')}
                aria-label={showTable ? 'Show chart' : 'Show table'}
                title={showTable ? 'Show chart' : 'Show table'}
              >
                {showTable ? <BarChart3 className="w-4 h-4" /> : <Table2 className="w-4 h-4" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={download}
              disabled={downloading || (!onServerCsv && !rows.length)}
              aria-label="Download CSV"
              title="Download CSV"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={`p-3 sm:p-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        {!rows.length ? (
          <div className="py-10 text-center text-sm text-slate-500">{loading ? 'Loading…' : emptyText}</div>
        ) : showTable ? (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider sticky top-0">
                <tr>
                  {columns.map(c => (
                    <th key={c.key} className={`font-medium px-3 py-2 whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.key ?? r.id ?? i} className="hover:bg-slate-50">
                    {columns.map(c => (
                      <td key={c.key} className={`px-3 py-2 whitespace-nowrap text-slate-700 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                        {c.format ? c.format(r[c.key], r) : (r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
};

export default ChartCard;
