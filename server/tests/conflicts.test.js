const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { findConflicts } = require('../utils/conflicts');

// Helper — build an interval object (matches what the DB returns)
function slot(start, end, extra = {}) {
  return { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), ...extra };
}

// Fixed "now" base: 2030-01-01 00:00 UTC (ms)
const BASE = Date.UTC(2030, 0, 1, 0, 0, 0);
const h    = n => BASE + n * 3_600_000;  // base + n hours

describe('findConflicts', () => {
  // ── no conflict cases ────────────────────────────────────────
  test('returns empty array when existing is empty', () => {
    assert.deepEqual(findConflicts([], slot(h(2), h(4))), []);
  });

  test('returns empty array for non-overlapping slot entirely before', () => {
    // existing: [2,4), requested: [0,2) — touch at boundary only, not overlap
    const existing = [slot(h(2), h(4))];
    assert.deepEqual(findConflicts(existing, slot(h(0), h(2))), []);
  });

  test('returns empty array for non-overlapping slot entirely after', () => {
    // existing: [2,4), requested: [4,6) — touch at boundary only
    const existing = [slot(h(2), h(4))];
    assert.deepEqual(findConflicts(existing, slot(h(4), h(6))), []);
  });

  test('returns empty array when gap between slots', () => {
    const existing = [slot(h(2), h(3)), slot(h(5), h(6))];
    assert.deepEqual(findConflicts(existing, slot(h(3), h(5))), []);
  });

  // ── overlap cases ────────────────────────────────────────────
  test('detects exact same window', () => {
    const existing = [slot(h(2), h(4))];
    const result   = findConflicts(existing, slot(h(2), h(4)));
    assert.equal(result.length, 1);
  });

  test('detects requested starts inside existing', () => {
    // existing: [2,6), requested: [4,8) — overlap [4,6)
    const existing = [slot(h(2), h(6))];
    assert.equal(findConflicts(existing, slot(h(4), h(8))).length, 1);
  });

  test('detects requested ends inside existing', () => {
    // existing: [4,8), requested: [2,6) — overlap [4,6)
    const existing = [slot(h(4), h(8))];
    assert.equal(findConflicts(existing, slot(h(2), h(6))).length, 1);
  });

  test('detects requested fully inside existing', () => {
    // existing: [0,10), requested: [3,7)
    const existing = [slot(h(0), h(10))];
    assert.equal(findConflicts(existing, slot(h(3), h(7))).length, 1);
  });

  test('detects existing fully inside requested', () => {
    // existing: [3,7), requested: [0,10)
    const existing = [slot(h(3), h(7))];
    assert.equal(findConflicts(existing, slot(h(0), h(10))).length, 1);
  });

  test('returns all conflicting slots, not just the first', () => {
    const existing = [slot(h(1), h(3)), slot(h(5), h(7)), slot(h(9), h(11))];
    // requested [2,10) overlaps with first two but not third (10 == 11 is touch, not overlap... wait)
    // [1,3) ∩ [2,10) = [2,3) ✓
    // [5,7) ∩ [2,10) = [5,7) ✓
    // [9,11) ∩ [2,10): 9 < 10 && 2 < 11 → ✓ also overlaps
    const conflicts = findConflicts(existing, slot(h(2), h(10)));
    assert.equal(conflicts.length, 3);
  });

  test('preserves extra fields on conflicting slots', () => {
    const existing = [slot(h(2), h(4), { id: 'abc', type: 'booking' })];
    const result   = findConflicts(existing, slot(h(1), h(3)));
    assert.equal(result[0].id, 'abc');
    assert.equal(result[0].type, 'booking');
  });

  // ── edge / guard cases ───────────────────────────────────────
  test('returns empty array when requested window is invalid (start >= end)', () => {
    const existing = [slot(h(2), h(4))];
    assert.deepEqual(findConflicts(existing, slot(h(5), h(3))), []);
  });

  test('skips existing slots with unparseable dates', () => {
    const existing = [
      { start_time: 'not-a-date', end_time: 'also-bad' },
      slot(h(2), h(4)),
    ];
    // only the valid slot may conflict
    const result = findConflicts(existing, slot(h(1), h(3)));
    assert.equal(result.length, 1);
  });
});
