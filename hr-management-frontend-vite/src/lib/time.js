// Helpers for clock-in/out screens. Times are shown in the company timezone
// returned by the API so everyone sees the same wall-clock times.

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const fmtTime = (value, timeZone = DEFAULT_TIMEZONE) => {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
};

export const fmtMinutes = (minutes) => {
  if (minutes == null) return '—';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!h) return `${rem}m`;
  return rem ? `${h}h ${rem}m` : `${h}h`;
};

// "09:30" -> "9:30 AM"
export const fmtShiftTime = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const REQUEST_TYPE_LABELS = {
  missed_punch: 'Attendance correction',
  wfh: 'Work from home',
  on_duty: 'On duty',
};

export const WORK_MODE_LABELS = {
  office: 'Office',
  wfh: 'WFH',
  on_duty: 'On duty',
};

// Best-effort browser location; resolves to {} if denied, unavailable or slow.
// The browser's own timeout only starts after the permission prompt is
// answered, so a hard cap keeps an ignored prompt from blocking the punch.
export const getPosition = (maxWaitMs = 8000) =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    setTimeout(() => resolve({}), maxWaitMs);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
