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

/**
 * Random password that meets every rule above: `length` characters with at
 * least one upper, lower, digit and symbol. Look-alike characters (O 0 l 1 I)
 * are left out so it can be read out or typed from a note.
 */
export const generatePassword = (length = 14) => {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?'];
  const all = sets.join('');
  const rand = (n) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const chars = sets.map((s) => s[rand(s.length)]);
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

/** "Password must have: at least 8 characters, one number (0–9)", or null. */
export const passwordPolicyMessage = (password) => {
  const unmet = unmetPasswordRules(password);
  return unmet.length ? `Password must have: ${unmet.map((l) => l.charAt(0).toLowerCase() + l.slice(1)).join(', ')}` : null;
};
