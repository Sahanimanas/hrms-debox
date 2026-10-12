/**
 * Travel request helpers (AS-2): trip expense summary and settlement maths.
 */

const { round2 } = require('./common');

const TRAVEL_MODES = ['flight', 'train', 'bus', 'car', 'cab', 'other'];
const TRAVEL_STATUSES = ['pending_manager', 'pending_admin', 'approved', 'rejected', 'cancelled', 'settled'];
const LINKABLE_TRIP_STATUSES = ['approved'];

/**
 * Claims linked to the trip and the settlement position:
 *   entitlement = claimed (not rejected) + per-diem
 *   balance     = entitlement − advance disbursed (positive → pay employee, negative → employee returns)
 */
async function tripSummary(db, trip) {
  const claims = await db.collection('reimbursements').find(
    { trip_id: trip.id },
    { projection: { _id: 0, id: 1, title: 1, category: 1, amount: 1, status: 1, expense_date: 1, bill_url: 1, policy_check: 1, policy_flagged: 1 } }
  ).sort({ expense_date: 1 }).toArray();

  const live = claims.filter(c => c.status !== 'rejected');
  const claimed = round2(live.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0));
  const approvedClaimed = round2(live.filter(c => ['approved', 'cleared'].includes(c.status)).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0));
  const perDiem = round2(trip.per_diem?.amount || 0);
  const advance = round2(trip.advance_status === 'disbursed' ? (trip.advance_disbursed_amount ?? trip.advance_requested ?? 0) : 0);
  const entitlement = round2(claimed + perDiem);
  const estimate = round2(trip.estimated_cost || 0);

  return {
    claims,
    claim_count: live.length,
    total_claimed: claimed,
    approved_claimed: approvedClaimed,
    per_diem_amount: perDiem,
    total_entitlement: entitlement,
    estimated_cost: estimate,
    variance_vs_estimate: round2(entitlement - estimate),
    over_estimate: estimate > 0 && entitlement > estimate,
    advance_disbursed: advance,
    balance: round2(entitlement - advance),
    settlement_direction: entitlement - advance > 0 ? 'payable_to_employee' : entitlement - advance < 0 ? 'recoverable_from_employee' : 'nil'
  };
}

module.exports = { TRAVEL_MODES, TRAVEL_STATUSES, LINKABLE_TRIP_STATUSES, tripSummary };
