/**
 * Housekeeping shared by the cron jobs (cron/jobs/recruitment.js) and the
 * router (which also applies them lazily, so data is correct even if cron
 * is disabled on an instance).
 */

const { localParts } = require('../../utils/helpers');
const { COLLECTIONS } = require('./constants');

const todayStr = () => localParts(new Date()).date;

/** Sent offers whose expiry date has passed become `expired`. */
async function expireOffers(db) {
  const today = todayStr();
  const offers = await db.collection(COLLECTIONS.offers)
    .find({ status: 'sent', expiry_date: { $lt: today } }, { projection: { _id: 0, id: 1, candidate_id: 1 } })
    .toArray();
  if (!offers.length) return { expired: 0 };
  const now = new Date();
  await db.collection(COLLECTIONS.offers).updateMany(
    { id: { $in: offers.map(o => o.id) }, status: 'sent' },
    { $set: { status: 'expired', expired_at: now, updated_at: now } }
  );
  await db.collection(COLLECTIONS.candidates).updateMany(
    { id: { $in: offers.map(o => o.candidate_id) }, offer_status: 'sent' },
    { $set: { offer_status: 'expired', updated_at: now } }
  );
  return { expired: offers.length, offer_ids: offers.map(o => o.id) };
}

/** Open postings whose closing date has passed are closed. */
async function closeExpiredJobs(db) {
  const today = todayStr();
  const now = new Date();
  const result = await db.collection(COLLECTIONS.jobs).updateMany(
    { status: 'open', closing_date: { $ne: null, $lt: today } },
    { $set: { status: 'closed', closed_at: now, closed_reason: 'closing_date', updated_at: now } }
  );
  return { closed: result.modifiedCount };
}

module.exports = { expireOffers, closeExpiredJobs, todayStr };
