'use strict';

const { isoFromUTCDate, pad, addDaysISO } = require('./dates');

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
 * Each entry: { name, officialDate, observedDate, kind }.
 */
function federalHolidaysInYear(year) {
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
  ].map((h) => Object.assign(h, { kind: 'federal' }));
}

/** @deprecated use federalHolidaysInYear; kept so older tests and callers still work. */
function holidaysInYear(year) {
  return federalHolidaysInYear(year);
}

// --- Hebrew calendar (Dershowitz/Reingold / fourmilab-style) ---
// Months: 1=Nisan, 2=Iyar, 3=Sivan, 4=Tammuz, 5=Av, 6=Elul,
//         7=Tishrei, 8=Cheshvan, 9=Kislev, 10=Tevet, 11=Shevat,
//         12=Adar (Adar I in a leap year), 13=Adar II (leap years only).

function isHebrewLeapYear(year) {
  return ((7 * year + 1) % 19) < 7;
}

function lastMonthOfHebrewYear(year) {
  return isHebrewLeapYear(year) ? 13 : 12;
}

function hebrewDelay1(year) {
  const monthsElapsed = Math.floor((235 * year - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  let day = monthsElapsed * 29 + Math.floor(partsElapsed / 25920);
  if ((3 * (day + 1)) % 7 < 3) day += 1;
  return day;
}

function hebrewDelay2(year) {
  const a = hebrewDelay1(year - 1);
  const b = hebrewDelay1(year);
  const c = hebrewDelay1(year + 1);
  if (c - b === 356) return 2;
  if (b - a === 382) return 1;
  return 0;
}

function daysInHebrewYear(year) {
  return hebrewDelay1(year + 1) + hebrewDelay2(year + 1) - (hebrewDelay1(year) + hebrewDelay2(year));
}

function daysInHebrewMonth(year, month) {
  if (month === 2 || month === 4 || month === 6 || month === 10 || month === 13) return 29;
  if (month === 12) return isHebrewLeapYear(year) ? 30 : 29;
  if (month === 8) return daysInHebrewYear(year) % 10 === 5 ? 30 : 29;
  if (month === 9) return daysInHebrewYear(year) % 10 === 3 ? 29 : 30;
  return 30;
}

// Julian day number of the Hebrew epoch (1 Tishrei AM 1), plus a 1-day
// adjustment so conversion matches published civil dates.
const HEBREW_EPOCH = 347995.5;

function gregorianToJdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045
  );
}

function jdnToGregorian(jdn) {
  const J = jdn;
  const f = J + 1401 + Math.floor((Math.floor((4 * J + 274277) / 146097) * 3) / 4) - 38;
  const e = 4 * f + 3;
  const g = Math.floor((e % 1461) / 4);
  const h = 5 * g + 2;
  const day = Math.floor((h % 153) / 5) + 1;
  const month = ((Math.floor(h / 153) + 2) % 12) + 1;
  const year = Math.floor(e / 1461) - 4716 + Math.floor((12 + 2 - month) / 12);
  return { year, month, day };
}

function hebrewToJdn(year, month, day) {
  let jd = HEBREW_EPOCH + hebrewDelay1(year) + hebrewDelay2(year) + day + 1;
  if (month < 7) {
    const last = lastMonthOfHebrewYear(year);
    for (let m = 7; m <= last; m++) jd += daysInHebrewMonth(year, m);
    for (let m = 1; m < month; m++) jd += daysInHebrewMonth(year, m);
  } else {
    for (let m = 7; m < month; m++) jd += daysInHebrewMonth(year, m);
  }
  return Math.floor(jd) + 1;
}

function hebrewToIso(hy, hm, hd) {
  const g = jdnToGregorian(hebrewToJdn(hy, hm, hd));
  return g.year + '-' + pad(g.month) + '-' + pad(g.day);
}

/**
 * Major Jewish holidays whose civil daytime falls in the given Gregorian year.
 * Diaspora calendar (two days of Rosh Hashanah and Shavuot; first two and last
 * two days of Passover; Shemini Atzeret and Simchat Torah observed separately).
 * Hanukkah is represented by the first night only (sundown on 24 Kislev).
 */
function jewishHolidaysInYear(year) {
  const y = Number(year);
  const out = [];
  const seen = new Set();

  function push(entry) {
    const key = entry.name + '@' + entry.officialDate;
    if (seen.has(key)) return;
    seen.add(key);
    if (Number(entry.officialDate.slice(0, 4)) !== y) return;
    out.push(entry);
  }

  for (let hy = y + 3759; hy <= y + 3762; hy++) {
    const purimMonth = isHebrewLeapYear(hy) ? 13 : 12;
    const specs = [
      { name: 'Rosh Hashanah', month: 7, day: 1, days: 2 },
      { name: 'Yom Kippur', month: 7, day: 10, days: 1 },
      { name: 'Sukkot', month: 7, day: 15, days: 2 },
      { name: 'Shemini Atzeret', month: 7, day: 22, days: 1 },
      { name: 'Simchat Torah', month: 7, day: 23, days: 1 },
      { name: 'Hanukkah (first night)', month: 9, day: 24, days: 1, firstNight: true },
      { name: 'Purim', month: purimMonth, day: 14, days: 1 },
      { name: 'Passover (first day)', month: 1, day: 15, days: 1 },
      { name: 'Passover (second day)', month: 1, day: 16, days: 1 },
      { name: 'Passover (seventh day)', month: 1, day: 21, days: 1 },
      { name: 'Passover (last day)', month: 1, day: 22, days: 1 },
      { name: 'Shavuot', month: 3, day: 6, days: 2 },
    ];
    for (const spec of specs) {
      const startJdn = hebrewToJdn(hy, spec.month, spec.day);
      for (let i = 0; i < spec.days; i++) {
        const g = jdnToGregorian(startJdn + i);
        const iso = g.year + '-' + pad(g.month) + '-' + pad(g.day);
        push({
          name: spec.name,
          officialDate: iso,
          observedDate: iso,
          kind: 'jewish',
          firstNight: !!spec.firstNight,
        });
      }
    }
  }
  out.sort((a, b) => a.officialDate.localeCompare(b.officialDate) || a.name.localeCompare(b.name));
  return out;
}

function shortHolidayLabel(name, opts) {
  const eve = opts && opts.eve;
  const observed = opts && opts.observed;
  const map = {
    "New Year's Day": "New Year's",
    'Martin Luther King Jr. Day': 'MLK Day',
    "Presidents' Day": "Presidents'",
    'Memorial Day': 'Memorial',
    'Juneteenth National Independence Day': 'Juneteenth',
    'Independence Day': 'July 4',
    'Labor Day': 'Labor',
    'Columbus / Indigenous Peoples Day': 'Indigenous',
    'Veterans Day': 'Veterans',
    'Thanksgiving Day': 'Thanksgiving',
    'Christmas Day': 'Christmas',
    'Rosh Hashanah': 'Rosh Hash.',
    'Yom Kippur': 'Yom Kippur',
    Sukkot: 'Sukkot',
    'Shemini Atzeret': 'Shemini Atz.',
    'Simchat Torah': 'Simchat T.',
    'Hanukkah (first night)': 'Hanukkah',
    Purim: 'Purim',
    'Passover (first day)': 'Passover',
    'Passover (second day)': 'Passover',
    'Passover (seventh day)': 'Passover',
    'Passover (last day)': 'Passover',
    Shavuot: 'Shavuot',
  };
  let s = map[name] || name;
  if (eve && name !== 'Hanukkah (first night)') s = 'Erev ' + s;
  if (observed) s += ' (obs.)';
  return s;
}

function observanceLabel(name, opts) {
  if (name === 'Hanukkah (first night)') return name;
  if (opts && opts.eve) return name + ' (starts at sundown)';
  if (opts && opts.observed) return name + ' (observed)';
  return name;
}

function collectObservancesOnDate(isoDate) {
  const year = Number(String(isoDate).slice(0, 4));
  if (!Number.isFinite(year)) return [];
  const items = [];

  const federal = federalHolidaysInYear(year - 1)
    .concat(federalHolidaysInYear(year), federalHolidaysInYear(year + 1));
  for (const h of federal) {
    if (h.officialDate === isoDate || h.observedDate === isoDate) {
      const observed = h.observedDate === isoDate && h.officialDate !== isoDate;
      items.push({
        name: h.name,
        officialDate: h.officialDate,
        observedDate: h.observedDate,
        observed,
        eve: false,
        kind: 'federal',
        label: observanceLabel(h.name, { observed }),
        shortLabel: shortHolidayLabel(h.name, { observed }),
      });
    }
  }

  const jewish = jewishHolidaysInYear(year - 1)
    .concat(jewishHolidaysInYear(year), jewishHolidaysInYear(year + 1));
  for (const h of jewish) {
    if (h.officialDate === isoDate) {
      const eve = !!h.firstNight;
      items.push({
        name: h.name,
        officialDate: h.officialDate,
        observedDate: h.officialDate,
        observed: false,
        eve,
        kind: 'jewish',
        label: observanceLabel(h.name, { eve }),
        shortLabel: shortHolidayLabel(h.name, { eve }),
      });
    } else if (!h.firstNight && addDaysISO(isoDate, 1) === h.officialDate) {
      items.push({
        name: h.name,
        officialDate: h.officialDate,
        observedDate: h.officialDate,
        observed: false,
        eve: true,
        kind: 'jewish',
        label: observanceLabel(h.name, { eve: true }),
        shortLabel: shortHolidayLabel(h.name, { eve: true }),
      });
    }
  }

  // Dedup (year-boundary overlap from scanning adjacent years)
  const seen = new Set();
  return items.filter((it) => {
    const key = it.kind + ':' + it.name + ':' + it.officialDate + ':' + (it.eve ? 'eve' : 'day') + ':' + (it.observed ? 'obs' : '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * If isoDate is an official or observed federal holiday, a major Jewish holiday,
 * or the evening a Jewish holiday begins (sundown the day before), return details.
 */
function holidayOnDate(isoDate) {
  const holidays = collectObservancesOnDate(isoDate);
  if (!holidays.length) return null;
  const primary = holidays[0];
  const kindSet = new Set(holidays.map((h) => h.kind));
  const kind = kindSet.size === 1 ? primary.kind : 'both';
  return {
    name: holidays.map((h) => h.name).join('; '),
    officialDate: primary.officialDate,
    observedDate: primary.observedDate,
    observed: holidays.some((h) => h.observed),
    eve: holidays.some((h) => h.eve),
    kind,
    label: holidays.map((h) => h.label).join('; '),
    shortLabel: holidays.map((h) => h.shortLabel).join(' · '),
    holidays,
  };
}

module.exports = {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  observedDate,
  holidaysInYear,
  federalHolidaysInYear,
  jewishHolidaysInYear,
  holidayOnDate,
  isHebrewLeapYear,
  hebrewToIso,
  gregorianToJdn,
  jdnToGregorian,
};
