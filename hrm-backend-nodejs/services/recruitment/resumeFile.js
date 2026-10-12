/**
 * Resume upload validation: extension + magic bytes (never trust the browser's
 * MIME type), size limit, and a safe display name.
 */

const path = require('path');
const { RESUME_MAX_BYTES } = require('./constants');

const TYPES = {
  '.pdf': {
    mime: 'application/pdf',
    label: 'PDF',
    // "%PDF-" — allow a little leading junk, which some generators emit
    matches: (buf) => buf.subarray(0, 1024).toString('latin1').includes('%PDF-')
  },
  '.doc': {
    mime: 'application/msword',
    label: 'DOC',
    // OLE2 compound document header
    matches: (buf) => buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  },
  '.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'DOCX',
    // ZIP local file header, and a Word part listed somewhere in the archive
    matches: (buf) => buf.length >= 4
      && buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      && buf.toString('latin1').includes('word/')
  }
};

/** Strip path parts and odd characters from an uploaded file name. */
const safeFileName = (name, ext) => {
  const base = path.basename(String(name || 'resume')).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
};

/**
 * @param {{ originalname: string, buffer: Buffer, size: number }} file multer file
 * @returns {{ ok: true, ext, mime, fileName } | { ok: false, error: string }}
 */
function validateResumeFile(file) {
  if (!file || !file.buffer) return { ok: false, error: 'Please attach your resume' };
  if (file.size > RESUME_MAX_BYTES || file.buffer.length > RESUME_MAX_BYTES) {
    return { ok: false, error: 'Resume must be 5 MB or smaller' };
  }
  if (file.buffer.length < 8) return { ok: false, error: 'The resume file is empty or unreadable' };

  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  const type = TYPES[ext];
  if (!type) return { ok: false, error: 'Resume must be a PDF, DOC or DOCX file' };
  if (!type.matches(file.buffer)) {
    return { ok: false, error: `The file does not look like a valid ${type.label} document` };
  }
  return { ok: true, ext, mime: type.mime, fileName: safeFileName(file.originalname, ext) };
}

module.exports = { validateResumeFile, RESUME_TYPES: TYPES };
