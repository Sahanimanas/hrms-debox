/**
 * Recruitment (ATS) constants shared by the router, cron jobs and tests.
 */

const COLLECTIONS = {
  requisitions: 'job_requisitions',
  jobs: 'job_postings',
  candidates: 'candidates',
  interviews: 'interviews', // shared contract — read by the platform calendar feed
  scorecards: 'interview_scorecards',
  offers: 'job_offers'
};

// Pipeline order. rejected / withdrawn are terminal side-exits.
const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
const ACTIVE_STAGES = ['applied', 'screening', 'interview', 'offer'];
const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
};

const SOURCES = ['careers_page', 'referral', 'job_board', 'manual'];
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary'];
const WORK_MODES = ['onsite', 'hybrid', 'remote'];
const JOB_STATUSES = ['draft', 'open', 'closed'];
const REQUISITION_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'filled'];

const INTERVIEW_MODES = ['onsite', 'video', 'phone'];
const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];
const RECOMMENDATIONS = ['strong_hire', 'hire', 'no_hire', 'strong_no_hire'];
const RECOMMENDATION_SCORE = { strong_hire: 2, hire: 1, no_hire: -1, strong_no_hire: -2 };

const OFFER_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];
const OPEN_OFFER_STATUSES = ['draft', 'sent', 'accepted'];

const DEFAULT_SCORECARD_CRITERIA = ['Technical skills', 'Problem solving', 'Communication', 'Culture fit'];

// What a referrer sees about their referral (no internal detail such as rejection reasons)
const REFERRAL_STATUS = {
  applied: 'In review',
  screening: 'In review',
  interview: 'Interviewing',
  offer: 'Offer stage',
  hired: 'Hired',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn'
};

const RESUME_MAX_BYTES = 5 * 1024 * 1024;

module.exports = {
  COLLECTIONS,
  STAGES,
  ACTIVE_STAGES,
  STAGE_LABELS,
  SOURCES,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  JOB_STATUSES,
  REQUISITION_STATUSES,
  INTERVIEW_MODES,
  INTERVIEW_STATUSES,
  RECOMMENDATIONS,
  RECOMMENDATION_SCORE,
  OFFER_STATUSES,
  OPEN_OFFER_STATUSES,
  DEFAULT_SCORECARD_CRITERIA,
  REFERRAL_STATUS,
  RESUME_MAX_BYTES
};
