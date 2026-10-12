const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/database');

/**
 * Hash password using bcrypt
 */
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/**
 * Verify password against hash
 */
const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate UUID
 */
const generateUUID = () => uuidv4();

/**
 * Calculate number of days between two dates
 */
const calculateDays = (startDate, endDate, isHalfDay = false) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  if (isHalfDay && diffDays === 1) {
    return 0.5;
  }
  
  return diffDays;
};

/**
 * Generate unique employee ID
 */
const generateEmployeeId = async () => {
  const db = getDB();
  
  // Get settings
  const settings = await db.collection('settings').findOne({});
  const prefix = settings?.employee_id_prefix || 'EMP';
  const startCounter = settings?.employee_id_counter || 1000;
  
  // Find highest counter
  const employees = await db.collection('employees')
    .find({}, { projection: { employee_id: 1 } })
    .toArray();
  
  let maxCounter = startCounter;
  
  for (const emp of employees) {
    const empId = emp.employee_id || '';
    if (empId.startsWith(prefix)) {
      try {
        const num = parseInt(empId.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxCounter) {
          maxCounter = num;
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
  }
  
  const newCounter = maxCounter + 1;
  return `${prefix}${String(newCounter).padStart(4, '0')}`;
};

/**
 * Normalize leave type to database key format
 */
const normalizeLeaveType = (leaveType) => {
  return leaveType.toLowerCase().replace(/ /g, '_');
};

/**
 * Get number of days in a month
 */
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

/**
 * Format date to ISO string
 */
const toISOString = (date) => {
  if (date instanceof Date) {
    return date.toISOString();
  }
  if (typeof date === 'string') {
    return new Date(date).toISOString();
  }
  return new Date().toISOString();
};

/**
 * Parse date from various formats
 */
const parseDate = (date) => {
  if (date instanceof Date) {
    return date;
  }
  if (typeof date === 'string') {
    return new Date(date);
  }
  return new Date();
};

/**
 * Format currency (INR)
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Get month name from date
 */
const getMonthName = (year, month) => {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
};

/**
 * Stable, unique key for an employee. The DB has two employee shapes:
 *  - app-created: { id (uuid), employee_id (EMPxxxx), ... }
 *  - seed-created: { _id (ObjectId), employee_code (EMPxxxx), ... }  (no employee_id)
 * Falling back here guarantees every employee gets a UNIQUE key so attendance
 * never collides across rows (e.g. all `undefined` → one shared cell).
 */
const employeeUid = (e) =>
  e.employee_id || e.employee_code || e.id || (e._id != null ? String(e._id) : undefined);

/**
 * Company timezone used for clock-in/out and "today" calculations.
 */
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

const tzFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23'
});

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Break a Date into wall-clock parts in the company timezone.
 * Returns { date: 'YYYY-MM-DD', year, month, day, weekday (0=Sun), minutes (since local midnight) }
 */
const localParts = (when = new Date()) => {
  const parts = Object.fromEntries(
    tzFormatter.formatToParts(when).map(p => [p.type, p.value])
  );
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year,
    month,
    day,
    weekday: WEEKDAYS[parts.weekday],
    minutes: hour * 60 + minute,
    _utcGuess: Date.UTC(year, month - 1, day, hour, minute, second)
  };
};

/**
 * Convert a wall-clock date + "HH:mm" in the company timezone to a real Date.
 */
const zonedTimeToDate = (dateStr, timeStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Offset of the zone at that instant, applied twice to settle across DST edges
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const offset = localParts(new Date(ts))._utcGuess - ts;
    ts = guess - offset;
  }
  return new Date(ts);
};

/**
 * "HH:mm" -> minutes since midnight
 */
const timeToMinutes = (timeStr) => {
  const [h, m] = String(timeStr).split(':').map(Number);
  return h * 60 + m;
};

module.exports = {
  hashPassword,
  verifyPassword,
  generateUUID,
  calculateDays,
  generateEmployeeId,
  normalizeLeaveType,
  getDaysInMonth,
  toISOString,
  parseDate,
  formatCurrency,
  getMonthName,
  employeeUid,
  APP_TIMEZONE,
  localParts,
  zonedTimeToDate,
  timeToMinutes
};
