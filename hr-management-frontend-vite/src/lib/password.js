// Password policy for new passwords. Mirrors hrm-backend-nodejs/utils/passwordPolicy.js —
// keep the two in sync.

export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'upper', label: 'One uppercase letter (A–Z)', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'One lowercase letter (a–z)', test: (pw) => /[a-z]/.test(pw) },
  { id: 'number', label: 'One number (0–9)', test: (pw) => /\d/.test(pw) },
  { id: 'special', label: 'One special character (e.g. ! @ # $ %)', test: (pw) => /[^A-Za-z0-9\s]/.test(pw) },
];

export const PASSWORD_MAX_LENGTH = 128;

/** Labels of the rules a password fails (empty array when it's acceptable). */
export const unmetPasswordRules = (password) => {
  const pw = String(password ?? '');
  const unmet = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label);
  if (pw.length > PASSWORD_MAX_LENGTH) unmet.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  return unmet;
};

/** "Password must have: at least 8 characters, one number (0–9)", or null. */
export const passwordPolicyMessage = (password) => {
  const unmet = unmetPasswordRules(password);
  return unmet.length ? `Password must have: ${unmet.map((l) => l.charAt(0).toLowerCase() + l.slice(1)).join(', ')}` : null;
};
