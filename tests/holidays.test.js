'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  holidaysInYear,
  holidayOnDate,
  observedDate,
  jewishHolidaysInYear,
  hebrewToIso,
} = require('../src/holidays');

describe('computed US federal holidays', () => {
  it('computes 2025 and 2026 Monday holidays and Thanksgiving', () => {
    const y2025 = Object.fromEntries(holidaysInYear(2025).map((h) => [h.name, h]));
    const y2026 = Object.fromEntries(holidaysInYear(2026).map((h) => [h.name, h]));

    assert.equal(y2025['Martin Luther King Jr. Day'].officialDate, '2025-01-20');
    assert.equal(y2025["Presidents' Day"].officialDate, '2025-02-17');
    assert.equal(y2025['Memorial Day'].officialDate, '2025-05-26');
    assert.equal(y2025['Labor Day'].officialDate, '2025-09-01');
    assert.equal(y2025['Columbus / Indigenous Peoples Day'].officialDate, '2025-10-13');
    assert.equal(y2025['Thanksgiving Day'].officialDate, '2025-11-27');

    assert.equal(y2026['Martin Luther King Jr. Day'].officialDate, '2026-01-19');
    assert.equal(y2026["Presidents' Day"].officialDate, '2026-02-16');
    assert.equal(y2026['Memorial Day'].officialDate, '2026-05-25');
    assert.equal(y2026['Labor Day'].officialDate, '2026-09-07');
    assert.equal(y2026['Columbus / Indigenous Peoples Day'].officialDate, '2026-10-12');
    assert.equal(y2026['Thanksgiving Day'].officialDate, '2026-11-26');
  });

  it('observes Saturday holidays on Friday and Sunday holidays on Monday', () => {
    // Independence Day 2026 is Saturday July 4 → observed Friday July 3
    assert.equal(observedDate(2026, 7, 4), '2026-07-03');
    const jul3 = holidayOnDate('2026-07-03');
    assert.ok(jul3);
    assert.equal(jul3.name, 'Independence Day');
    assert.equal(jul3.observed, true);
    assert.equal(holidayOnDate('2026-07-04').observed, false);
    assert.equal(holidayOnDate('2026-07-06'), null);

    // New Year's Day 2023 was Sunday → observed Monday Jan 2
    const ny = holidayOnDate('2023-01-02');
    assert.ok(ny);
    assert.equal(ny.name, "New Year's Day");
    assert.equal(ny.observed, true);
    assert.equal(ny.officialDate, '2023-01-01');
  });

  it('returns a label for holiday Mondays used by the calendar', () => {
    const mlk = holidayOnDate('2026-01-19');
    assert.equal(mlk.label, 'Martin Luther King Jr. Day');
    assert.equal(holidayOnDate('2026-11-09'), null);
  });
});

describe('computed Jewish holidays (diaspora)', () => {
  function datesNamed(year, name) {
    return jewishHolidaysInYear(year).filter((h) => h.name === name).map((h) => h.officialDate);
  }

  it('matches published 2026 dates (Hebcal / Chabad / JCRC)', () => {
    assert.deepEqual(datesNamed(2026, 'Purim'), ['2026-03-03']);
    assert.deepEqual(datesNamed(2026, 'Passover (first day)'), ['2026-04-02']);
    assert.deepEqual(datesNamed(2026, 'Passover (last day)'), ['2026-04-09']);
    assert.deepEqual(datesNamed(2026, 'Shavuot'), ['2026-05-22', '2026-05-23']);
    assert.deepEqual(datesNamed(2026, 'Rosh Hashanah'), ['2026-09-12', '2026-09-13']);
    assert.deepEqual(datesNamed(2026, 'Yom Kippur'), ['2026-09-21']);
    assert.deepEqual(datesNamed(2026, 'Sukkot'), ['2026-09-26', '2026-09-27']);
    assert.deepEqual(datesNamed(2026, 'Shemini Atzeret'), ['2026-10-03']);
    assert.deepEqual(datesNamed(2026, 'Simchat Torah'), ['2026-10-04']);
    assert.deepEqual(datesNamed(2026, 'Hanukkah (first night)'), ['2026-12-04']);
  });

  it('matches published 2027 dates (Hebcal / Chabad / JCRC)', () => {
    assert.deepEqual(datesNamed(2027, 'Purim'), ['2027-03-23']);
    assert.deepEqual(datesNamed(2027, 'Passover (first day)'), ['2027-04-22']);
    assert.deepEqual(datesNamed(2027, 'Passover (last day)'), ['2027-04-29']);
    assert.deepEqual(datesNamed(2027, 'Shavuot'), ['2027-06-11', '2027-06-12']);
    assert.deepEqual(datesNamed(2027, 'Rosh Hashanah'), ['2027-10-02', '2027-10-03']);
    assert.deepEqual(datesNamed(2027, 'Yom Kippur'), ['2027-10-11']);
    assert.deepEqual(datesNamed(2027, 'Sukkot'), ['2027-10-16', '2027-10-17']);
    assert.deepEqual(datesNamed(2027, 'Shemini Atzeret'), ['2027-10-23']);
    assert.deepEqual(datesNamed(2027, 'Simchat Torah'), ['2027-10-24']);
    assert.deepEqual(datesNamed(2027, 'Hanukkah (first night)'), ['2027-12-24']);
  });

  it('flags a Monday when a holiday falls that day or starts that evening', () => {
    const yk = holidayOnDate('2026-09-21');
    assert.ok(yk);
    assert.equal(yk.kind, 'jewish');
    assert.equal(yk.eve, false);
    assert.match(yk.label, /Yom Kippur/);
    assert.equal(holidayOnDate('2026-09-20').eve, true);
    assert.match(holidayOnDate('2026-09-20').label, /starts at sundown/);

    // Purim 2027 starts Monday evening March 22
    const erevPurim = holidayOnDate('2027-03-22');
    assert.ok(erevPurim);
    assert.equal(erevPurim.eve, true);
    assert.match(erevPurim.label, /Purim/);
    const purimDay = holidayOnDate('2027-03-23');
    assert.equal(purimDay.eve, false);
    assert.match(purimDay.label, /Purim/);
  });

  it('treats Hanukkah first night as the evening it begins, not the day before', () => {
    const firstNight = holidayOnDate('2026-12-04');
    assert.ok(firstNight);
    assert.match(firstNight.label, /Hanukkah/);
    assert.equal(holidayOnDate('2026-12-03'), null);
    // First daytime of Hanukkah is not auto-flagged — only the first night
    assert.equal(holidayOnDate('2026-12-05'), null);
  });

  it('converts 1 Tishrei correctly across a range of years', () => {
    assert.equal(hebrewToIso(5787, 7, 1), '2026-09-12');
    assert.equal(hebrewToIso(5788, 7, 1), '2027-10-02');
    assert.equal(hebrewToIso(5780, 7, 1), '2019-09-30');
    assert.equal(hebrewToIso(5791, 7, 1), '2030-09-28');
  });
});
