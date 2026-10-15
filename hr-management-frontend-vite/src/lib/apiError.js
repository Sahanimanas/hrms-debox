// Turn an axios error from the API into a message worth showing.
// The backend's validation middleware answers 422 { detail: 'Validation failed', errors: [{ field, message }] };
// those per-field messages are what the user needs, not the generic detail.

const FIELD_LABELS = {
  full_name: 'Full name',
  email: 'Email',
  password: 'Password',
  new_password: 'Password',
  phone: 'Phone',
  department: 'Department',
  designation: 'Designation',
  joining_date: 'Joining date',
  date_of_birth: 'Date of birth',
  manager_email: 'Manager email',
  organization_id: 'Organization',
};

const cleanJoiMessage = (message) => String(message || '').replace(/^"([^"]+)"\s*/, (_, f) => `${FIELD_LABELS[f] || f.replace(/_/g, ' ')} `);

/** Per-field messages as { field: message } (first message per field). */
export function apiFieldErrors(error) {
  const list = error?.response?.data?.errors;
  if (!Array.isArray(list)) return {};
  const out = {};
  for (const e of list) {
    const field = e?.field || 'general';
    if (!out[field]) out[field] = cleanJoiMessage(e?.message);
  }
  return out;
}

/** One readable string: the field messages when present, otherwise `detail`, otherwise the fallback. */
export function apiErrorMessage(error, fallback = 'Something went wrong') {
  const fields = apiFieldErrors(error);
  const messages = Object.values(fields).filter(Boolean);
  if (messages.length) return messages.join(' · ');
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((d) => (typeof d === 'object' && d?.msg ? d.msg : String(d))).join('; ');
  if (typeof detail === 'string' && detail) return detail;
  return fallback;
}
