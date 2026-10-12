/**
 * File storage for uploaded documents.
 *
 * Uses S3 when it is configured (production) and falls back to the local
 * `uploads/` folder otherwise (development / tests).
 *
 * Public files (the default) are reachable by URL: S3 public-read objects, or
 * local files served by server.js at `/uploads/...`. Private files
 * ({ visibility: 'private' }) such as resumes, tax proofs and employee
 * documents are never served directly: S3 objects are private and local files
 * live under `uploads/private/`, which server.js refuses to serve. Read them
 * back with readStoredFile() inside an authenticated endpoint.
 */

const fs = require('fs');
const path = require('path');
const { generateUUID } = require('../utils/helpers');
const PRIVATE_DIR = 'private';
const s3 = require('./s3Service');

const LOCAL_ROOT = path.join(__dirname, '..', 'uploads');

const safeSegment = (value) => String(value || 'misc').replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Store a file.
 * @param {{ visibility?: 'public'|'private' }} [options]
 * @returns {Promise<{ key: string, url: string|null, storage: 's3'|'local', visibility: string }>}
 */
async function storeFile(buffer, originalName, mimeType, folder, ownerId, { visibility = 'public' } = {}) {
  const isPrivate = visibility === 'private';
  if (s3.isS3Configured()) {
    const { key, url } = await s3.uploadFile(buffer, originalName, mimeType, folder, ownerId, { acl: isPrivate ? 'private' : 'public-read' });
    return { key, url: isPrivate ? null : url, storage: 's3', visibility };
  }

  const ext = path.extname(originalName || '').slice(0, 10);
  const segments = [safeSegment(folder), safeSegment(ownerId)];
  if (isPrivate) segments.unshift(PRIVATE_DIR);
  const relDir = segments.join('/');
  const fileName = `${generateUUID()}${ext}`;
  fs.mkdirSync(path.join(LOCAL_ROOT, ...segments), { recursive: true });
  fs.writeFileSync(path.join(LOCAL_ROOT, ...segments, fileName), buffer);

  const key = `local/${relDir}/${fileName}`;
  if (isPrivate) return { key, url: null, storage: 'local', visibility };
  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
  return { key, url: `${base}/uploads/${relDir}/${fileName}`, storage: 'local', visibility };
}

/**
 * Read a stored file back into memory (for authenticated downloads).
 * Works for public and private files, local or S3. Returns null if missing.
 */
async function readStoredFile(key) {
  if (!key) return null;
  if (key.startsWith('local/')) {
    const filePath = path.join(LOCAL_ROOT, key.slice('local/'.length));
    if (!filePath.startsWith(LOCAL_ROOT) || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }
  const url = await s3.getPresignedUrl(key, 120);
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Delete a stored file by key. Never throws.
 */
async function removeFile(key) {
  if (!key) return;
  try {
    if (key.startsWith('local/')) {
      const filePath = path.join(LOCAL_ROOT, key.slice('local/'.length));
      if (filePath.startsWith(LOCAL_ROOT) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    await s3.deleteFile(key);
  } catch (error) {
    console.error('[storage] Failed to delete file:', key, error.message);
  }
}

module.exports = { storeFile, removeFile, readStoredFile, LOCAL_ROOT, PRIVATE_DIR };
