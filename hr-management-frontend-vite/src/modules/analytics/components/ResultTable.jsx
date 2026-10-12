import React from 'react';
import { Download, TableProperties } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { exportCsv } from '@/lib/exportCsv';

const fmtCell = (v, type) => {
  if (v == null || v === '') return '—';
  if (type === 'boolean') return v ? 'Yes' : 'No';
  if (type === 'datetime') {
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (type === 'number') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return String(v);
};

/** Result grid for a report run: { columns: [{ key, label, type }], rows, total_rows, truncated }. */
const ResultTable = ({ result, title = 'Results', filename }) => {
  const { columns = [], rows = [] } = result || {};
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm sm:text-base flex items-center gap-2"><TableProperties className="w-4 h-4 text-slate-600" /> {title}</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {rows.length} of {result?.total_rows ?? rows.length} row(s){result?.truncated ? ' — limited by the row limit' : ''}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!rows.length}
            onClick={() => exportCsv(filename || title, rows, columns.map(c => ({ key: c.key, label: c.label })))}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!rows.length ? (
          <div className="text-center py-10 text-sm text-slate-500">No rows match this report</div>
        ) : (
          <div className="overflow-auto max-h-[28rem]">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider sticky top-0">
                <tr>
                  {columns.map(c => (
                    <th key={c.key} className={`font-medium px-3 py-2 whitespace-nowrap ${c.type === 'number' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {columns.map(c => (
                      <td key={c.key} className={`px-3 py-2 whitespace-nowrap text-slate-700 ${c.type === 'number' ? 'text-right tabular-nums' : ''}`}>{fmtCell(r[c.key], c.type)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ResultTable;
