/**
 * Loan housekeeping shared by the router and event listeners (PY-7).
 */

const { generateUUID, localParts } = require('../../utils/helpers');

/**
 * Close an exited employee's loans after full & final settlement
 * (the lifecycle module recovers the whole outstanding balance in F&F).
 *
 *  - disbursed loans: a 'settlement' repayment for the outstanding amount is
 *    recorded, outstanding -> 0, status 'closed', closed_reason 'recovered_in_settlement'
 *  - pending / approved (not yet paid out) requests: status 'cancelled'
 *
 * Idempotent: only loans still in those states are touched, and each update is
 * conditioned on the state it read.
 * Returns { closed: [{ loan_id, amount }], cancelled: [loan_id] }.
 */
async function settleLoansOnExit(db, { employee_uid, email, employee_email } = {}) {
  const who = [
    ...(employee_uid ? [{ employee_uid }] : []),
    ...((email || employee_email) ? [{ employee_email: email || employee_email }] : [])
  ];
  if (!who.length) return { closed: [], cancelled: [] };

  const now = new Date();
  const month = localParts(now).date.slice(0, 7);
  const loans = await db.collection('loans')
    .find({ $or: who, status: { $in: ['disbursed', 'approved', 'pending'] } }, { projection: { _id: 0 } })
    .toArray();

  const closed = [];
  const cancelled = [];
  for (const loan of loans) {
    if (loan.status === 'disbursed') {
      const amount = Math.round((loan.outstanding || 0) * 100) / 100;
      const res = await db.collection('loans').updateOne(
        { id: loan.id, status: 'disbursed', outstanding: loan.outstanding },
        {
          $set: { outstanding: 0, status: 'closed', closed_reason: 'recovered_in_settlement', closed_at: now, updated_at: now },
          $inc: { recovered: amount },
          $push: {
            repayments: { id: generateUUID(), type: 'settlement', amount, date: now, at: now, month, run_id: null, ref: 'full_and_final' }
          }
        }
      );
      if (res.modifiedCount) closed.push({ loan_id: loan.id, amount });
    } else {
      const res = await db.collection('loans').updateOne(
        { id: loan.id, status: loan.status },
        { $set: { status: 'cancelled', closed_reason: 'employee_exited', updated_at: now } }
      );
      if (res.modifiedCount) cancelled.push(loan.id);
    }
  }
  return { closed, cancelled };
}

module.exports = { settleLoansOnExit };
