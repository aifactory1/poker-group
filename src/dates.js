'use strict';

const TZ = 'America/Phoenix';

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseISODate(iso) {
  const parts = String(iso).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('Invalid ISO date: ' + iso);
  }
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
}

function isoFromUTCDate(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function addDaysISO(iso, n) {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoFromUTCDate(d);
}

function weekdayUTC(iso) {
  return parseISODate(iso).getUTCDay();
}

function todayISO(now = new Date(), timeZone = TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

function nowTimeHHMM(now = new Date(), timeZone = TZ) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(now);
}

/** Upcoming Monday on or after iso (ISO weekday: Monday = 1). */
function upcomingMondayOnOrAfter(iso) {
  const d = parseISODate(iso);
  const day = d.getUTCDay();
  const add = (1 - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return isoFromUTCDate(d);
}

function formatNiceDate(iso) {
  return parseISODate(iso).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime12(hhmm) {
  if (!hhmm) return '';
  const parts = String(hhmm).split(':').map(Number);
  let h = parts[0];
  const m = parts[1] || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ':' + pad(m) + ' ' + ampm;
}

function weekdayName(n) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n];
}

/**
 * Instant for a Phoenix wall time on a calendar date.
 * Arizona does not observe DST (UTC-7 year-round).
 */
function phoenixDateTime(isoDate, hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return new Date(isoDate + 'T' + pad(h || 0) + ':' + pad(m || 0) + ':00-07:00');
}

function monthStartISO(year, month /* 1-12 */) {
  return year + '-' + pad(month) + '-01';
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}

module.exports = {
  TZ,
  parseISODate,
  isoFromUTCDate,
  addDaysISO,
  weekdayUTC,
  todayISO,
  nowTimeHHMM,
  upcomingMondayOnOrAfter,
  formatNiceDate,
  formatTime12,
  weekdayName,
  phoenixDateTime,
  monthStartISO,
  daysInMonth,
  monthLabel,
  pad,
};
