'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { holidaysInYear, holidayOnDate, observedDate } = require('../src/holidays');

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
