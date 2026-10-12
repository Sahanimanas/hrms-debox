/**
 * Payroll scheduled jobs.
 */

const { localParts } = require('../../utils/helpers');
const { getSettings } = require('../../services/payroll/settings');
const engine = require('../../services/payroll/engine');
const { fyOf } = require('../../services/payroll/statutory');
const { createNotification } = require('../../services/notificationService');

module.exports = [
  {
    name: 'payroll-auto-draft',
    schedule: '30 6 * * *',
    description: 'Create the draft payroll run for the month 5 days before pay day (when auto-draft is on in payroll settings)',
    run: async (db) => {
      const settings = await getSettings(db);
      if (!settings.auto_draft_enabled) return { skipped: 'auto-draft disabled' };
      const today = localParts(new Date());
      const triggerDay = Math.max(1, (settings.pay_day || 1) - 5);
      if (today.day !== triggerDay && !(triggerDay > 28 && today.day === 28)) return { skipped: `runs on day ${triggerDay}` };
      // Pay day early in the month pays the previous month
      const payPrevious = (settings.pay_day || 1) <= 10;
      const d = new Date(Date.UTC(today.year, today.month - 1 - (payPrevious ? 1 : 0), 1));
      const month = d.toISOString().slice(0, 7);
      const existing = await db.collection('payroll_runs').findOne({ month });
      if (existing) return { skipped: `run for ${month} exists` };
      const run = await engine.createRun(db, month, { email: 'system', full_name: 'Scheduler' });
      return { created: run.id, month, employees: run.employee_count };
    }
  },
  {
    name: 'payroll-proof-reminder',
    schedule: '0 10 * * 1',
    description: 'Weekly reminder to employees with unverified investment declarations in the 30 days before the proof deadline',
    run: async (db) => {
      const settings = await getSettings(db);
      if (!settings.proof_deadline) return { skipped: 'no proof deadline set' };
      const today = localParts(new Date()).date;
      const days = (Date.parse(settings.proof_deadline) - Date.parse(today)) / 86400000;
      if (days < 0 || days > 30) return { skipped: 'outside reminder window' };
      const fy = fyOf(today.slice(0, 7));
      const list = await db.collection('tax_declarations').find(
        { financial_year: fy, items: { $elemMatch: { status: 'declared', proofs: { $size: 0 } } } },
        { projection: { _id: 0, employee_email: 1 } }
      ).toArray();
      for (const d of list) {
        const user = await db.collection('users').findOne({ email: d.employee_email }, { projection: { _id: 0, id: 1 } });
        await createNotification({
          userId: user?.id || null,
          userEmail: d.employee_email,
          type: 'tax_proof_reminder',
          title: 'Upload investment proofs',
          message: `Upload proofs for your tax declarations before ${settings.proof_deadline}, or the declared amounts stop counting for TDS.`,
          actionUrl: '/my-tax'
        });
      }
      return { reminded: list.length };
    }
  }
];
