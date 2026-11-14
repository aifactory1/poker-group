'use strict';

const { isoFromUTCDate, pad } = require('./dates');

function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const firstDow = first.getUTCDay();
  const add = (weekday - firstDow + 7) % 7 + (n - 1) * 7;
  const d = new Date(Date.UTC(year, month - 1, 1 + add, 12, 0, 0));
  return isoFromUTCDate(d);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  const lastDow = last.getUTCDay();
  const sub = (lastDow - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - sub);
  return isoFromUTCDate(last);
}

function officialFixed(year, month, day) {
  return year + '-' + pad(month) + '-' + pad(day);
}

/** Saturday → Friday, Sunday → Monday. */
function observedDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return isoFromUTCDate(d);
}

/**
 * Compute U.S. federal holidays for a given year (algorithmic, not a table).
 * Each entry: { name, officialDate, observedDate }.
 */
function holidaysInYear(year) {
  const y = Number(year);
  return [
    {
      name: "New Year's Day",
      officialDate: officialFixed(y, 1, 1),
      observedDate: observedDate(y, 1, 1),
    },
    {
      name: 'Martin Luther King Jr. Day',
      officialDate: nthWeekdayOfMonth(y, 1, 1, 3),
      observedDate: nthWeekdayOfMonth(y, 1, 1, 3),
    },
    {
      name: "Presidents' Day",
      officialDate: nthWeekdayOfMonth(y, 2, 1, 3),
      observedDate: nthWeekdayOfMonth(y, 2, 1, 3),
    },
    {
      name: 'Memorial Day',
      officialDate: lastWeekdayOfMonth(y, 5, 1),
      observedDate: lastWeekdayOfMonth(y, 5, 1),
    },
    {
      name: 'Juneteenth National Independence Day',
      officialDate: officialFixed(y, 6, 19),
      observedDate: observedDate(y, 6, 19),
    },
    {
      name: 'Independence Day',
      officialDate: officialFixed(y, 7, 4),
      observedDate: observedDate(y, 7, 4),
    },
    {
      name: 'Labor Day',
      officialDate: nthWeekdayOfMonth(y, 9, 1, 1),
      observedDate: nthWeekdayOfMonth(y, 9, 1, 1),
    },
    {
      name: 'Columbus / Indigenous Peoples Day',
      officialDate: nthWeekdayOfMonth(y, 10, 1, 2),
      observedDate: nthWeekdayOfMonth(y, 10, 1, 2),
    },
    {
      name: 'Veterans Day',
      officialDate: officialFixed(y, 11, 11),
      observedDate: observedDate(y, 11, 11),
    },
    {
      name: 'Thanksgiving Day',
      officialDate: nthWeekdayOfMonth(y, 11, 4, 4),
      observedDate: nthWeekdayOfMonth(y, 11, 4, 4),
    },
    {
      name: 'Christmas Day',
      officialDate: officialFixed(y, 12, 25),
      observedDate: observedDate(y, 12, 25),
    },
  ];
}

/**
 * If isoDate is an official or observed federal holiday, return details.
 * Checks adjacent years so New Year's observed dates at year boundaries work.
 */
function holidayOnDate(isoDate) {
  const year = Number(String(isoDate).slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const list = holidaysInYear(year - 1).concat(holidaysInYear(year), holidaysInYear(year + 1));
  for (const h of list) {
    if (h.officialDate === isoDate || h.observedDate === isoDate) {
      const observed = h.observedDate === isoDate && h.officialDate !== isoDate;
      return {
        name: h.name,
        officialDate: h.officialDate,
        observedDate: h.observedDate,
        observed,
        label: observed ? h.name + ' (observed)' : h.name,
      };
    }
  }
  return null;
}

module.exports = {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  observedDate,
  holidaysInYear,
  holidayOnDate,
};
