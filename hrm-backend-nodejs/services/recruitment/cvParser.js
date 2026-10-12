/**
 * Lightweight, best-effort resume parsing (no third-party packages).
 *
 * Goal: prefill email / phone / LinkedIn URL from an uploaded resume.
 *
 * What it handles
 *  - PDF: walks every `stream … endstream`, inflates /FlateDecode streams with
 *    zlib (uncompressed streams are read as-is), and pulls text out of content
 *    streams (Tj / TJ / ' / " operators, literal and hex strings). Hex strings
 *    from CID fonts are decoded through any ToUnicode CMaps found in the file
 *    (bfchar / bfrange). Link annotations (`/URI (…)`, `mailto:`) are scanned
 *    in both raw and inflated data, which catches LinkedIn URLs even when the
 *    visible text is not extractable.
 *  - DOCX: reads the ZIP central directory, inflates word/document.xml and its
 *    relationships (hyperlinks) with zlib.inflateRawSync, strips the XML.
 *  - DOC (legacy binary): scans the raw bytes as Latin-1 and UTF-16LE text.
 *
 * What it does not handle: scanned/image-only PDFs (needs OCR), encrypted
 * PDFs, streams with other filters (LZW, ASCII85…), CMaps that are not
 * embedded, per-font CMap selection (all CMaps are tried in order), and
 * names / work history extraction.
 */

const zlib = require('zlib');

const MAX_STREAMS = 400;
const MAX_INFLATED_BYTES = 8 * 1024 * 1024; // per stream (zip-bomb guard)
const MAX_TOTAL_TEXT = 2 * 1024 * 1024;

// ---------------------------------------------------------------- helpers

const inflate = (buf) => {
  const opts = { maxOutputLength: MAX_INFLATED_BYTES };
  try {
    return zlib.inflateSync(buf, opts);
  } catch {
    try {
      // Tolerate truncated streams / bad /Length
      return zlib.inflateSync(buf, { ...opts, finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      try {
        return zlib.inflateRawSync(buf, opts);
      } catch {
        return null;
      }
    }
  }
};

const utf16beToString = (bytes) => {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
};

const hexToBytes = (hex) => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const padded = clean.length % 2 ? `${clean}0` : clean;
  return Buffer.from(padded, 'hex');
};

// ---------------------------------------------------------------- CMaps

/** Parse a ToUnicode CMap into { codeLength, map: Map<code, string> }. */
function parseCMap(text) {
  const map = new Map();
  let codeLength = 2;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
  if (cs) codeLength = Math.max(1, Math.ceil(cs[1].length / 2));

  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  let block;
  while ((block = bfchar.exec(text))) {
    const pair = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
    let p;
    while ((p = pair.exec(block[1]))) map.set(parseInt(p[1], 16), utf16beToString(hexToBytes(p[2])));
  }

  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrange.exec(text))) {
    const entry = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g;
    let e;
    while ((e = entry.exec(block[1]))) {
      const lo = parseInt(e[1], 16);
      const hi = parseInt(e[2], 16);
      if (hi < lo || hi - lo > 65535) continue;
      if (e[3].startsWith('[')) {
        const dsts = [...e[3].matchAll(/<([0-9a-fA-F]*)>/g)].map(m => utf16beToString(hexToBytes(m[1])));
        dsts.forEach((d, i) => { if (lo + i <= hi) map.set(lo + i, d); });
      } else {
        const base = hexToBytes(e[3].slice(1, -1));
        if (!base.length) continue;
        for (let code = lo; code <= hi; code++) {
          const bytes = Buffer.from(base);
          // increment the last byte(s) by the offset
          let carry = code - lo;
          for (let i = bytes.length - 1; i >= 0 && carry; i--) {
            const v = bytes[i] + carry;
            bytes[i] = v & 0xff;
            carry = v >> 8;
          }
          map.set(code, utf16beToString(bytes));
        }
      }
    }
  }
  return { codeLength, map };
}

const decodeWithCMap = (bytes, cmap) => {
  const n = cmap.codeLength;
  if (bytes.length % n) return null;
  let out = '';
  for (let i = 0; i < bytes.length; i += n) {
    let code = 0;
    for (let j = 0; j < n; j++) code = (code << 8) | bytes[i + j];
    const ch = cmap.map.get(code);
    if (ch === undefined) return null;
    out += ch;
  }
  return out;
};

const isMostlyPrintable = (bytes) => {
  if (!bytes.length) return true;
  let ok = 0;
  for (const b of bytes) if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x0d || b === 0x09 || b >= 0xa0) ok++;
  return ok / bytes.length > 0.9;
};

// ---------------------------------------------------------------- content streams

/** Read a PDF literal string starting at s[i] === '('. Returns [bytes, nextIndex]. */
function readLiteral(s, i) {
  const out = [];
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      const n = s[j + 1];
      j++;
      if (n === 'n') out.push(10);
      else if (n === 'r') out.push(13);
      else if (n === 't') out.push(9);
      else if (n === 'b') out.push(8);
      else if (n === 'f') out.push(12);
      else if (n === '\r' || n === '\n') { if (n === '\r' && s[j + 1] === '\n') j++; }
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(s[j + 1])) oct += s[++j];
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n !== undefined) out.push(n.charCodeAt(0) & 0xff);
      continue;
    }
    if (c === '(') {
      depth++;
      if (depth === 1) continue;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return [Buffer.from(out), j + 1];
    }
    out.push(c.charCodeAt(0) & 0xff);
  }
  return [Buffer.from(out), j];
}

function makeDecoder(cmaps) {
  return (bytes, wasHex) => {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16beToString(bytes.subarray(2));
    if (cmaps.length && (wasHex || !isMostlyPrintable(bytes))) {
      for (const cmap of cmaps) {
        const decoded = decodeWithCMap(bytes, cmap);
        if (decoded !== null) return decoded;
      }
    }
    return bytes.toString('latin1');
  };
}

/** Extract visible text from a PDF content stream. */
function textFromContentStream(s, decode) {
  let out = '';
  let i = 0;
  let inArray = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '(') {
      const [bytes, next] = readLiteral(s, i);
      out += decode(bytes, false);
      i = next;
      continue;
    }
    if (c === '<') {
      if (s[i + 1] === '<') { i += 2; continue; }
      const close = s.indexOf('>', i);
      if (close === -1) break;
      out += decode(hexToBytes(s.slice(i + 1, close)), true);
      i = close + 1;
      continue;
    }
    if (c === '[') { inArray = true; i++; continue; }
    if (c === ']') { inArray = false; i++; continue; }
    if (c === '%') {
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (inArray && /[-+.\d]/.test(c)) {
      let j = i + 1;
      while (j < n && /[.\d]/.test(s[j])) j++;
      const num = parseFloat(s.slice(i, j));
      if (num < -180) out += ' '; // large negative kerning in TJ ≈ word space
      i = j;
      continue;
    }
    if (/[A-Za-z'"*]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z*'"]/.test(s[j])) j++;
      const op = s.slice(i, j);
      if (op === 'Td' || op === 'TD' || op === 'T*' || op === "'" || op === '"' || op === 'ET') out += '\n';
      else if (op === 'Tm') out += ' ';
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function extractPdf(buffer) {
  const raw = buffer.toString('latin1');
  const contentStreams = [];
  const decodedChunks = []; // every inflated stream (for link annotations in object streams)
  const cmaps = [];

  let idx = 0;
  let count = 0;
  while ((idx = raw.indexOf('stream', idx)) !== -1 && count < MAX_STREAMS) {
    if (raw.slice(Math.max(0, idx - 3), idx) === 'end') { idx += 6; continue; }
    let start = idx + 6;
    if (raw[start] === '\r') start++;
    if (raw[start] === '\n') start++;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    count++;

    const objStart = raw.lastIndexOf(' obj', idx);
    const dict = raw.slice(Math.max(objStart, idx - 2000, 0), idx);
    let data = buffer.subarray(start, end);
    if (/\/FlateDecode|\/Fl\b/.test(dict)) {
      data = inflate(data);
    } else if (/\/Filter/.test(dict)) {
      data = null; // images (DCT), LZW, ASCII85 … not supported
    }
    if (data) {
      const text = data.toString('latin1');
      if (text.includes('begincmap')) cmaps.push(parseCMap(text));
      else if (/\bT[Jj]\b|\bTj|\]\s*TJ/.test(text) && /\bBT\b/.test(text)) contentStreams.push(text);
      if (/\/URI|mailto:|linkedin/i.test(text)) decodedChunks.push(text);
    }
    idx = end + 9;
  }

  const decode = makeDecoder(cmaps);
  let text = '';
  for (const stream of contentStreams) {
    text += `${textFromContentStream(stream, decode)}\n`;
    if (text.length > MAX_TOTAL_TEXT) break;
  }
  // Link annotations in uncompressed objects and inflated object streams
  const links = [...decodedChunks, raw]
    .flatMap(chunk => [...chunk.matchAll(/\/URI\s*\(([^)]{1,500})\)/g)].map(m => m[1]))
    .join('\n');
  return { text, links, method: 'pdf-text' };
}

// ---------------------------------------------------------------- DOCX

function readZipEntries(buffer) {
  // End of central directory record (search the last 64 KB)
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const from = Math.max(0, buffer.length - 66000);
  const eocd = buffer.lastIndexOf(sig);
  if (eocd < from || eocd + 22 > buffer.length) return new Map();
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < entries && offset + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    out.set(name, { method, compSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readZipFile(buffer, entry) {
  const lo = entry.localOffset;
  if (lo + 30 > buffer.length || buffer.readUInt32LE(lo) !== 0x04034b50) return null;
  const nameLen = buffer.readUInt16LE(lo + 26);
  const extraLen = buffer.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const data = buffer.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    try { return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES }); } catch { return null; }
  }
  return null;
}

const decodeXmlEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

function extractDocx(buffer) {
  const entries = readZipEntries(buffer);
  const doc = entries.get('word/document.xml');
  const xml = doc ? readZipFile(buffer, doc) : null;
  let text = '';
  if (xml) {
    text = decodeXmlEntities(xml.toString('utf8')
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<\/w:p>|<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, ''));
  }
  const rels = entries.get('word/_rels/document.xml.rels');
  const relXml = rels ? readZipFile(buffer, rels) : null;
  const links = relXml
    ? [...relXml.toString('utf8').matchAll(/Target="([^"]+)"[^>]*TargetMode="External"/g)].map(m => decodeXmlEntities(m[1])).join('\n')
    : '';
  return { text, links, method: 'docx-xml' };
}

// ---------------------------------------------------------------- DOC

function extractDoc(buffer) {
  // Word 97-2003 stores text as 8-bit or UTF-16LE runs inside the OLE container
  const latin = buffer.toString('latin1').replace(/[^\x20-\x7e\n\r\t]+/g, ' ');
  const utf16 = buffer.toString('utf16le').replace(/[^\x20-\x7e\n\r\t]+/g, ' ');
  return { text: `${latin}\n${utf16}`, links: '', method: 'doc-raw' };
}

// ---------------------------------------------------------------- field extraction

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_%\-.]+\/?/gi;
const PHONE_RE = /\+?\(?\d[\d\s().-]{7,18}\d/g;

function pickPhone(text) {
  for (const m of text.matchAll(PHONE_RE)) {
    const candidate = m[0].trim();
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(candidate)) continue; // year ranges
    if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(candidate)) continue; // dates
    return candidate.replace(/\s+/g, ' ');
  }
  return null;
}

function pickFields(text, links) {
  const haystack = `${text}\n${links}`;
  const emails = [...haystack.matchAll(EMAIL_RE)].map(m => m[0].replace(/^mailto:/i, ''));
  const mailto = [...links.matchAll(/mailto:([^\s?)]+)/gi)].map(m => m[1]);
  const email = (mailto[0] || emails.find(e => !/\.(png|jpe?g|gif)$/i.test(e)) || null);

  const linkedinMatch = [...haystack.matchAll(LINKEDIN_RE)][0];
  let linkedin = linkedinMatch ? linkedinMatch[0].replace(/[).,]+$/, '') : null;
  if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = `https://${linkedin}`;

  return {
    email: email ? email.toLowerCase().slice(0, 254) : null,
    phone: pickPhone(text),
    linkedin_url: linkedin ? linkedin.slice(0, 300) : null
  };
}

/**
 * @param {Buffer} buffer
 * @param {string} ext '.pdf' | '.doc' | '.docx'
 * @returns {{ email, phone, linkedin_url, method, text_chars, found: string[] }}
 */
function parseResume(buffer, ext) {
  let extracted = { text: '', links: '', method: 'none' };
  try {
    if (ext === '.pdf') extracted = extractPdf(buffer);
    else if (ext === '.docx') extracted = extractDocx(buffer);
    else if (ext === '.doc') extracted = extractDoc(buffer);
  } catch (error) {
    console.error('[recruitment] resume parse failed:', error.message);
  }
  const text = (extracted.text || '').replace(/\u0000/g, '').slice(0, MAX_TOTAL_TEXT);
  const fields = pickFields(text, extracted.links || '');
  return {
    ...fields,
    method: extracted.method,
    text_chars: text.replace(/\s+/g, '').length,
    found: Object.entries(fields).filter(([, v]) => v).map(([k]) => k)
  };
}

module.exports = { parseResume, _internal: { extractPdf, extractDocx, parseCMap, textFromContentStream, pickFields } };
