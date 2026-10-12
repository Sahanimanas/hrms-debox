/**
 * EL-4 Document vault helpers: types, storing a file as an employee document,
 * and reading a stored file back for authenticated download.
 */

const fs = require('fs');
const path = require('path');
const { storeFile, readStoredFile: readStored } = require('../fileStorage');
const { generateUUID, uidOf } = require('./common');

const DOCUMENT_TYPES = [
  { key: 'offer_letter', label: 'Offer letter' },
  { key: 'appointment_letter', label: 'Appointment letter' },
  { key: 'contract', label: 'Contract' },
  { key: 'id_proof', label: 'ID proof' },
  { key: 'address_proof', label: 'Address proof' },
  { key: 'education', label: 'Education' },
  { key: 'experience', label: 'Experience' },
  { key: 'certification', label: 'Certification' },
  { key: 'other', label: 'Other' }
];
const DOCUMENT_TYPE_KEYS = DOCUMENT_TYPES.map(t => t.key);

const ALLOWED_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc'
};
const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx', '.doc'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const isAllowedFile = (mimeType, originalName) => {
  const ext = path.extname(originalName || '').toLowerCase();
  return !!ALLOWED_MIME[mimeType] && ALLOWED_EXT.includes(ext);
};

/** Store a buffer and create an employee_documents record. */
const createVaultDocument = async (db, {
  employee,
  type,
  title,
  buffer,
  fileName,
  mimeType,
  expiryDate = null,
  source = 'upload',
  verificationStatus = 'pending',
  actor = null,
  extra = {}
}) => {
  const uid = uidOf(employee);
  const stored = await storeFile(buffer, fileName, mimeType, 'lifecycle_documents', uid, { visibility: 'private' });
  const now = new Date();
  const doc = {
    id: generateUUID(),
    employee_uid: uid,
    employee_id: employee.id || null,
    employee_email: employee.email,
    employee_name: employee.full_name,
    department: employee.department || null,
    type,
    title,
    file_key: stored.key,
    file_url: stored.url,
    storage: stored.storage,
    file_name: fileName,
    mime_type: mimeType,
    size: buffer.length,
    expiry_date: expiryDate || null,
    verification_status: verificationStatus,
    verified_by: verificationStatus === 'verified' ? (actor?.email || 'system') : null,
    verified_at: verificationStatus === 'verified' ? now : null,
    rejection_reason: null,
    source,
    uploaded_by: actor?.email || 'system',
    uploaded_by_name: actor?.full_name || null,
    expiry_alert_stage: null,
    created_at: now,
    updated_at: now,
    ...extra
  };
  await db.collection('employee_documents').insertOne(doc);
  delete doc._id;
  return doc;
};

/** Read a stored file into memory (local disk or S3, public or private). */
const readStoredFile = async (doc) => {
  if (doc.file_key) return readStored(doc.file_key);
  if (doc.file_url) {
    const r = await fetch(doc.file_url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  return null;
};

/** API view of a document: no storage key / raw URL (downloads go through the authenticated endpoint). */
const publicDoc = (d) => {
  if (!d) return d;
  const { _id, file_key, file_url, ...rest } = d; // eslint-disable-line no-unused-vars
  return { ...rest, download_url: `/v2/lifecycle/documents/${d.id}/download` };
};

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_KEYS,
  ALLOWED_MIME,
  MAX_FILE_SIZE,
  isAllowedFile,
  createVaultDocument,
  readStoredFile,
  publicDoc
};
