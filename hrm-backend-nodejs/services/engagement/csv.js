/**
 * Minimal CSV writer (same format as the frontend's exportCsv).
 * Cells that start with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
 */

const escapeCell = (value) => {
  if (value == null) return '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (rows, columns) => {
  const header = columns.map(c => escapeCell(c.label ?? c.key)).join(',');
  const body = rows.map(row => columns.map(c => escapeCell(c.value ? c.value(row) : row[c.key])).join(','));
  return [header, ...body].join('\r\n');
};

module.exports = { toCsv, escapeCell };
