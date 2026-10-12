/**
 * EL-5 Letter templates: placeholders, default templates and rendering.
 */

const { fmtDate, money } = require('./pdf');
const { toDateStr, todayStr } = require('./common');

const PLACEHOLDERS = [
  { key: 'full_name', label: 'Employee full name' },
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'joining_date', label: 'Date of joining' },
  { key: 'exit_date', label: 'Exit / last working date' },
  { key: 'monthly_salary', label: 'Monthly salary' },
  { key: 'annual_ctc', label: 'Annual CTC (monthly salary x 12)' },
  { key: 'manager_name', label: 'Reporting manager' },
  { key: 'today', label: "Today's date" },
  { key: 'company_name', label: 'Company name' }
];

const LETTER_TYPES = ['offer', 'appointment', 'experience', 'relieving', 'other'];

// Where a generated letter is filed in the document vault
const VAULT_TYPE_FOR_LETTER = {
  offer: 'offer_letter',
  appointment: 'appointment_letter',
  experience: 'experience',
  relieving: 'experience',
  other: 'other'
};

const DEFAULT_TEMPLATES = [
  {
    name: 'Offer letter',
    type: 'offer',
    title: 'Offer of Employment',
    body: `Dear {{full_name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department at {{company_name}}. Your expected date of joining is {{joining_date}}.

Your annual cost to company will be {{annual_ctc}} (monthly {{monthly_salary}}), subject to applicable deductions. You will report to {{manager_name}}.

This offer is subject to verification of your documents and references. Please confirm your acceptance by signing and returning a copy of this letter.

We look forward to welcoming you to the team.`
  },
  {
    name: 'Appointment letter',
    type: 'appointment',
    title: 'Letter of Appointment',
    body: `Dear {{full_name}},

With reference to your application and subsequent discussions, we are pleased to appoint you as {{designation}} in the {{department}} department of {{company_name}} with effect from {{joining_date}}. Your employee ID is {{employee_id}}.

Your annual cost to company will be {{annual_ctc}}. You will be on probation as per company policy, after which your services may be confirmed in writing.

You will be governed by the rules, policies and code of conduct of the company in force from time to time. Either party may terminate this employment by giving notice as per company policy.

Please sign and return the duplicate copy of this letter as a token of your acceptance.`
  },
  {
    name: 'Experience letter',
    type: 'experience',
    title: 'Experience Certificate',
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{full_name}} (Employee ID {{employee_id}}) was employed with {{company_name}} from {{joining_date}} to {{exit_date}}. At the time of leaving, {{full_name}} held the position of {{designation}} in the {{department}} department.

During this tenure we found {{full_name}} to be sincere, hardworking and professional.

We wish {{full_name}} all the best in future endeavours.`
  },
  {
    name: 'Relieving letter',
    type: 'relieving',
    title: 'Relieving Letter',
    body: `Dear {{full_name}},

This is with reference to your resignation. We confirm that you have been relieved from the services of {{company_name}} at the close of working hours on {{exit_date}}.

You were working with us as {{designation}} in the {{department}} department since {{joining_date}}. Your full and final settlement has been processed as per company policy.

We thank you for your contributions and wish you success in your future endeavours.`
  }
];

const formatMoney = (n) => (n == null || n === '' || isNaN(Number(n)) ? '' : money(Number(n)));

/** Values for every placeholder for an employee. */
const placeholderValues = async (db, employee, settings) => {
  let managerName = employee.manager_name || null;
  if (!managerName && employee.manager_email) {
    const m = await db.collection('employees').findOne({ email: employee.manager_email }, { projection: { full_name: 1 } });
    managerName = m?.full_name || null;
  }
  const salary = Number(employee.monthly_salary);
  const hasSalary = employee.monthly_salary != null && employee.monthly_salary !== '' && !isNaN(salary);
  return {
    full_name: employee.full_name || '',
    employee_id: employee.employee_id || employee.employee_code || '',
    designation: employee.designation || '',
    department: employee.department || '',
    joining_date: employee.joining_date ? fmtDate(toDateStr(employee.joining_date)) : '',
    exit_date: employee.exit_date ? fmtDate(toDateStr(employee.exit_date)) : '',
    monthly_salary: hasSalary ? formatMoney(salary) : '',
    annual_ctc: hasSalary ? formatMoney(salary * 12) : '',
    manager_name: managerName || '',
    today: fmtDate(todayStr()),
    company_name: settings.company_name || ''
  };
};

/** Replace {{placeholders}}; returns the text and the placeholders that had no value. */
const renderText = (text, values) => {
  const missing = new Set();
  const out = String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) => {
    if (!(key in values)) return match; // unknown placeholder: leave as typed
    if (values[key] === '' || values[key] == null) {
      missing.add(key);
      return '________';
    }
    return values[key];
  });
  return { text: out, missing: [...missing] };
};

const unknownPlaceholders = (text) => {
  const known = new Set(PLACEHOLDERS.map(p => p.key));
  const found = new Set();
  String(text || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, key) => {
    if (!known.has(key)) found.add(key);
    return m;
  });
  return [...found];
};

module.exports = {
  PLACEHOLDERS,
  LETTER_TYPES,
  VAULT_TYPE_FOR_LETTER,
  DEFAULT_TEMPLATES,
  placeholderValues,
  renderText,
  unknownPlaceholders
};
