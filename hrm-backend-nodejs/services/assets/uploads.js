/**
 * multer helpers that turn upload errors into clean 400 responses.
 */

const multer = require('multer');

const RECEIPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/**
 * Middleware accepting one file in `field`.
 * @param {{ maxBytes: number, types?: string[], typeError?: string, extensions?: string[] }} opts
 */
function singleUpload(field, { maxBytes, types, typeError, extensions } = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = (file.originalname || '').toLowerCase().split('.').pop();
      const okType = !types || types.includes(String(file.mimetype).toLowerCase());
      const okExt = extensions && extensions.includes(ext);
      if (okType || okExt) return cb(null, true);
      const err = new Error(typeError || 'Unsupported file type');
      err.code = 'UNSUPPORTED_TYPE';
      return cb(err);
    }
  }).single(field);

  return (req, res, next) => upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ detail: `File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` });
    }
    if (err.code === 'UNSUPPORTED_TYPE') return res.status(400).json({ detail: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ detail: err.message });
    return next(err);
  });
}

const receiptUpload = (field) => singleUpload(field, {
  maxBytes: MAX_RECEIPT_BYTES,
  types: RECEIPT_TYPES,
  typeError: 'Only image (JPG, PNG, GIF, WEBP) and PDF files are allowed'
});

module.exports = { singleUpload, receiptUpload, RECEIPT_TYPES, MAX_RECEIPT_BYTES };
