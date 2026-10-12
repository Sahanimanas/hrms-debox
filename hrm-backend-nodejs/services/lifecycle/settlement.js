/**
 * EL-2 Full and final settlement calculator.
 *
 * Auto lines (recomputed on demand, manual lines are kept):
 *  - salary for the days worked in the final month (skipped if a locked payslip exists)
 *  - leave encashment: earned-leave balance x basic / 26
 *  - gratuity (payroll module's calculator if present, else 15/26 x basic x years, >= 5 years)
 *  - outstanding loans (deduction)
 *  - notice-period shortfall recovery for resignations (deduction, gross / 30 per day)
 */

const { generateUUID, round2, toDateStr, diffDays, uidOf } = require('./common');

const GRATUITY_CAP = 2000000;

/** Monthly gross and basic for an employee. */
const salaryBasis = async (db, employee, settings) => {
  const uid = uidOf(employee);
  const structure = await db.collection('salary_structures').findOne({ employee_id: { $in: [uid, employee.id].filter(Boolean) } });
  if (structure && (Number(structure.basic_salary) > 0 || (structure.components || []).length)) {
    const base = Number(structure.basic_salary) || 0;
    const earnings = (structure.components || [])
      .filter(c => c.type === 'earning')
      .map(c => ({
        name: c.name || '',
        amount: c.is_percentage && (c.calculation_base === 'ctc' || c.calculation_base === 'basic' || !c.calculation_base)
          ? (base * Number(c.amount || 0)) / 100
          : Number(c.calculated_amount ?? c.amount ?? 0)
      }));
    const basicComponent = earnings.find(e => /basic/i.test(e.name));
    let gross;
    let basic;
    if (basicComponent) {
      gross = earnings.reduce((s, e) => s + e.amount, 0);
      basic = basicComponent.amount;
    } else if (earnings.length) {
      basic = base;
      gross = base + earnings.reduce((s, e) => s + e.amount, 0);
    } else {
      basic = base;
      gross = base;
    }
    return { gross: round2(gross), basic: round2(basic), source: 'salary_structure' };
  }
  const gross = Number(employee.monthly_salary) || 0;
  const pct = Number(settings.basic_percent_of_gross) || 50;
  return { gross: round2(gross), basic: round2((gross * pct) / 100), source: 'monthly_salary' };
};

/** Completed years of service; 6+ extra months round up (Payment of Gratuity Act). */
const serviceYears = (joinStr, exitStr) => {
  if (!joinStr || !exitStr) return { years: 0, exact: 0 };
  const days = Math.max(0, diffDays(joinStr, exitStr) + 1);
  const exact = days / 365.25;
  const whole = Math.floor(exact);
  const remainderMonths = (exact - whole) * 12;
  return { years: remainderMonths >= 6 ? whole + 1 : whole, exact };
};

const inlineGratuity = ({ basicMonthly, joiningDate, exitDate }) => {
  const { years, exact } = serviceYears(toDateStr(joiningDate), toDateStr(exitDate));
  const eligible = exact >= 5;
  const amount = eligible ? Math.min(GRATUITY_CAP, (15 / 26) * basicMonthly * years) : 0;
  return { amount: round2(amount), eligible, years, source: 'inline' };
};

/** Use the payroll module's gratuity calculator when it exists. */
const computeGratuity = (args) => {
  let external = null;
  try {
    external = require('../payroll/gratuity');
  } catch {
    external = null;
  }
  if (external && typeof external.computeGratuity === 'function') {
    try {
      const r = external.computeGratuity({ ...args, joiningDate: new Date(args.joiningDate), exitDate: new Date(args.exitDate) });
      if (typeof r === 'number') return { amount: round2(r), eligible: r > 0, years: null, source: 'payroll' };
      if (r && typeof r === 'object') {
        const amount = Number(r.amount ?? r.gratuity ?? r.value ?? 0);
        return {
          amount: round2(amount),
          eligible: r.eligible ?? amount > 0,
          years: r.years ?? r.service_years ?? r.yearsOfService ?? null,
          source: 'payroll'
        };
      }
    } catch (error) {
      console.error('[lifecycle] payroll gratuity failed, using inline formula:', error.message);
    }
  }
  return inlineGratuity(args);
};

const line = (key, label, type, amount, detail) => ({
  id: generateUUID(), key, label, type, amount: round2(amount), auto: true, detail
});

/** Compute auto settlement lines for a separation. */
const computeAutoLines = async (db, separation, employee, settings) => {
  const uid = uidOf(employee);
  const exitStr = separation.last_working_day;
  const joinStr = toDateStr(employee.joining_date) || exitStr;
  const pay = await salaryBasis(db, employee, settings);
  const lines = [];
  const notes = [];

  // 1. Salary for days worked in the final month
  const [ey, em] = exitStr.split('-').map(Number);
  const monthKey = `${ey}-${String(em).padStart(2, '0')}`;
  const monthStart = `${monthKey}-01`;
  const daysInMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  const periodStart = joinStr > monthStart ? joinStr : monthStart;
  const daysWorked = Math.max(0, diffDays(periodStart, exitStr) + 1);
  const paidSlip = await db.collection('payslips').findOne({
    employee_uid: uid,
    month: monthKey,
    status: { $in: ['locked', 'paid', 'final', 'published'] }
  });
  if (paidSlip) {
    notes.push(`Salary for ${monthKey} already processed in payroll`);
  } else if (pay.gross > 0 && daysWorked > 0) {
    lines.push(line('salary', `Salary for ${monthKey} (${daysWorked}/${daysInMonth} days)`, 'earning',
      (pay.gross * daysWorked) / daysInMonth,
      `Monthly gross ${pay.gross} x ${daysWorked} / ${daysInMonth}`));
  }

  // 2. Leave encashment
  const elKey = settings.earned_leave_key || 'earned_leave';
  const elBalance = Number(employee.leave_balance?.[elKey]) || 0;
  if (elBalance > 0 && pay.basic > 0) {
    lines.push(line('leave_encashment', `Leave encashment (${elBalance} earned leave days)`, 'earning',
      (elBalance * pay.basic) / 26, `${elBalance} x basic ${pay.basic} / 26`));
  }

  // 3. Gratuity
  const gratuity = computeGratuity({ basicMonthly: pay.basic, joiningDate: joinStr, exitDate: exitStr });
  if (gratuity.amount > 0) {
    lines.push(line('gratuity', 'Gratuity', 'earning', gratuity.amount,
      `15/26 x basic ${pay.basic}${gratuity.years != null ? ` x ${gratuity.years} years` : ''} (${gratuity.source})`));
  } else {
    notes.push('Not eligible for gratuity (less than 5 years of service)');
  }

  // 4. Outstanding loans
  const loans = await db.collection('loans').find({
    employee_uid: uid,
    outstanding: { $gt: 0 },
    status: { $nin: ['closed', 'rejected', 'cancelled', 'paid', 'completed', 'pending'] }
  }).toArray();
  for (const loan of loans) {
    lines.push(line(`loan:${loan.id}`, `Loan recovery${loan.purpose ? ` — ${loan.purpose}` : ''}`, 'deduction',
      Number(loan.outstanding), `Outstanding on loan of ${loan.principal ?? '—'}`));
  }

  // 5. Notice-period shortfall
  if (separation.type === 'resignation' && !separation.waive_notice_recovery) {
    const submitted = toDateStr(separation.submitted_on || separation.created_at);
    const served = Math.max(0, diffDays(submitted, exitStr));
    const required = Number(separation.notice_period_days) || 0;
    const shortfall = Math.max(0, required - served);
    if (shortfall > 0 && pay.gross > 0) {
      lines.push(line('notice_recovery', `Notice-period shortfall (${shortfall} days)`, 'deduction',
        (pay.gross / 30) * shortfall, `${required} days required, ${served} served; gross ${pay.gross} / 30 per day`));
    }
  }

  return { lines, notes, basis: { ...pay, days_worked: daysWorked, days_in_month: daysInMonth, earned_leave_balance: elBalance, gratuity } };
};

const totalsOf = (lines) => {
  const earnings = round2(lines.filter(l => l.type === 'earning').reduce((s, l) => s + l.amount, 0));
  const deductions = round2(lines.filter(l => l.type === 'deduction').reduce((s, l) => s + l.amount, 0));
  return { earnings, deductions, net: round2(earnings - deductions) };
};

module.exports = { salaryBasis, serviceYears, inlineGratuity, computeGratuity, computeAutoLines, totalsOf };
