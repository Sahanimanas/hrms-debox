// Download rows as a CSV file (opens in Excel).
//
//   exportCsv('employees', rows, [
//     { key: 'full_name', label: 'Name' },
//     { label: 'Joined', value: (r) => r.joining_date?.slice(0, 10) },
//   ]);

const escapeCell = (value) => {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {}).map(key => ({ key, label: key }));
  const header = cols.map(c => escapeCell(c.label ?? c.key)).join(',');
  const body = rows.map(row => cols.map(c => escapeCell(c.value ? c.value(row) : row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

export function exportCsv(filename, rows, columns) {
  // BOM so Excel opens UTF-8 (₹, names in Indic scripts) correctly
  const blob = new Blob(['﻿' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
