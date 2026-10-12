/**
 * Minimal RFC 4180 CSV parsing / writing (quoted fields, escaped quotes,
 * CRLF or LF line endings, optional UTF-8 BOM).
 */

function parseCsv(text) {
  const input = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // Drop fully blank lines
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/** Parse CSV into objects keyed by normalised header (lowercase, spaces → _). */
function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(h => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const records = rows.slice(1).map((r, idx) => {
    const obj = { __row: idx + 2 }; // spreadsheet row number (header is row 1)
    headers.forEach((h, i) => { obj[h] = r[i] != null ? String(r[i]).trim() : ''; });
    return obj;
  });
  return { headers, records };
}

const escapeCell = (value) => {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function toCsv(headers, rows) {
  return [headers.map(escapeCell).join(','), ...rows.map(r => r.map(escapeCell).join(','))].join('\r\n');
}

module.exports = { parseCsv, parseCsvObjects, toCsv };
