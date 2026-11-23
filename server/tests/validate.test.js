const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  requireString,
  requireDatetime,
  requireDate,
  requireFutureWindow,
  requireUuid,
} = require('../utils/validate');

describe('requireString', () => {
  test('returns trimmed value for valid string', () => {
    assert.equal(requireString('  hello  ', 'field'), 'hello');
  });
  test('throws 400 for empty string', () => {
    assert.throws(() => requireString('', 'field'), { status: 400 });
  });
  test('throws 400 for whitespace-only string', () => {
    assert.throws(() => requireString('   ', 'field'), { status: 400 });
  });
  test('throws 400 for non-string', () => {
    assert.throws(() => requireString(42, 'field'), { status: 400 });
  });
});

describe('requireDatetime', () => {
  test('returns ISO string for valid datetime', () => {
    const result = requireDatetime('2030-06-15T10:00:00Z', 'start_time');
    assert.match(result, /^\d{4}-\d{2}-\d{2}T/);
  });
  test('throws 400 for invalid datetime', () => {
    assert.throws(() => requireDatetime('not-a-date', 'start_time'), { status: 400 });
  });
  test('throws 400 for empty string', () => {
    assert.throws(() => requireDatetime('', 'start_time'), { status: 400 });
  });
});

describe('requireDate', () => {
  test('accepts valid YYYY-MM-DD', () => {
    assert.equal(requireDate('2030-12-31', 'deadline'), '2030-12-31');
  });
  test('throws 400 for wrong format', () => {
    assert.throws(() => requireDate('12/31/2030', 'deadline'), { status: 400 });
  });
  test('throws 400 for invalid calendar date', () => {
    assert.throws(() => requireDate('2030-13-01', 'deadline'), { status: 400 });
  });
});

describe('requireFutureWindow', () => {
  const future1 = new Date(Date.now() + 3_600_000).toISOString();  // +1h
  const future2 = new Date(Date.now() + 7_200_000).toISOString();  // +2h
  const past    = new Date(Date.now() - 3_600_000).toISOString();  // -1h

  test('does not throw for valid future window', () => {
    assert.doesNotThrow(() => requireFutureWindow(future1, future2));
  });
  test('throws 400 when end <= start', () => {
    assert.throws(() => requireFutureWindow(future2, future1), { status: 400 });
  });
  test('throws 400 when start is in the past', () => {
    assert.throws(() => requireFutureWindow(past, future1), { status: 400 });
  });
});

describe('requireUuid', () => {
  test('accepts valid v4 UUID', () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000001';
    assert.equal(requireUuid(id, 'id'), id);
  });
  test('throws 400 for non-UUID string', () => {
    assert.throws(() => requireUuid('not-a-uuid', 'id'), { status: 400 });
  });
  test('throws 400 for empty string', () => {
    assert.throws(() => requireUuid('', 'id'), { status: 400 });
  });
  test('throws 400 for null', () => {
    assert.throws(() => requireUuid(null, 'id'), { status: 400 });
  });
});
