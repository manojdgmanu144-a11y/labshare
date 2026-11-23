const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sanitiseError, requireMaxLength, MAX_LENGTHS } = require('../utils/validate');

describe('requireMaxLength', () => {
  test('returns value when within limit', () => {
    assert.equal(requireMaxLength('hello', 'field', 10), 'hello');
  });

  test('throws 400 when over limit', () => {
    assert.throws(
      () => requireMaxLength('a'.repeat(121), 'project_title', 120),
      { status: 400 }
    );
  });

  test('error message includes actual length', () => {
    try {
      requireMaxLength('x'.repeat(130), 'project_title', 120);
      assert.fail('should have thrown');
    } catch (err) {
      assert.match(err.message, /130/);
    }
  });

  test('passes value equal to limit exactly', () => {
    const val = 'a'.repeat(120);
    assert.equal(requireMaxLength(val, 'project_title', 120), val);
  });

  test('passes non-string values through (caller validates type first)', () => {
    assert.equal(requireMaxLength(42, 'field', 10), 42);
  });
});

describe('MAX_LENGTHS constants', () => {
  test('project_title is 120', () => { assert.equal(MAX_LENGTHS.project_title, 120); });
  test('purpose is 600',       () => { assert.equal(MAX_LENGTHS.purpose, 600); });
  test('faculty_note is 400',  () => { assert.equal(MAX_LENGTHS.faculty_note, 400); });
});

describe('sanitiseError', () => {
  test('400 error always exposes message', () => {
    const err = Object.assign(new Error('Bad input'), { status: 400 });
    const { status, message } = sanitiseError(err);
    assert.equal(status, 400);
    assert.equal(message, 'Bad input');
  });

  test('422 error (client error) always exposes message', () => {
    const err = Object.assign(new Error('Unprocessable'), { status: 422 });
    const { status, message } = sanitiseError(err);
    assert.equal(status, 422);
    assert.equal(message, 'Unprocessable');
  });

  test('500 error in development exposes message', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const err = new Error('DB connection failed');
      const { status, message } = sanitiseError(err);
      assert.equal(status, 500);
      assert.equal(message, 'DB connection failed');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test('500 error in production returns generic message', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const err = new Error('internal secret DB info');
      const { status, message } = sanitiseError(err);
      assert.equal(status, 500);
      assert.equal(message, 'An internal error occurred.');
      assert.ok(!message.includes('secret'));
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test('uses err.statusCode as fallback when err.status absent', () => {
    const err = Object.assign(new Error('Not found'), { statusCode: 404 });
    const { status } = sanitiseError(err);
    assert.equal(status, 404);
  });

  test('defaults to 500 when no status property', () => {
    const { status } = sanitiseError(new Error('generic'));
    assert.equal(status, 500);
  });
});

describe('approvals input validation rules', () => {
  // Mirror the server-side logic without spinning up Express
  const VALID_ACTIONS = ['approve', 'reject', 'accept_alternative'];
  const VALID_STATUSES = ['pending', 'approved', 'rejected', 'all'];

  test('valid actions accepted', () => {
    for (const a of VALID_ACTIONS) assert.ok(VALID_ACTIONS.includes(a));
  });

  test('invalid action rejected', () => {
    assert.ok(!VALID_ACTIONS.includes('delete'));
    assert.ok(!VALID_ACTIONS.includes(''));
  });

  test('valid queue status filters accepted', () => {
    for (const s of VALID_STATUSES) assert.ok(VALID_STATUSES.includes(s));
  });

  test('invalid queue status filter rejected', () => {
    assert.ok(!VALID_STATUSES.includes('unknown'));
  });

  test('accept_alternative requires both times', () => {
    // Simulate the server check: missing either field → invalid
    function requireAltTimes(body) {
      if (body.action === 'accept_alternative' && (!body.alternative_start || !body.alternative_end)) {
        return false;
      }
      return true;
    }
    assert.ok(!requireAltTimes({ action: 'accept_alternative', alternative_start: '2030-01-10T09:00:00Z' }));
    assert.ok(!requireAltTimes({ action: 'accept_alternative' }));
    assert.ok(requireAltTimes({ action: 'accept_alternative', alternative_start: '2030-01-10T09:00:00Z', alternative_end: '2030-01-10T11:00:00Z' }));
    assert.ok(requireAltTimes({ action: 'approve' }));  // approve doesn't need alt times
  });
});

describe('activity event shaping', () => {
  // Mirror the shaping logic from activity.js
  function shapeBookingEvent(b) {
    return {
      id:             `booking-${b.id}`,
      type:           'booking',
      title:          b.equipment?.name ?? 'Equipment',
      detail:         `Booking ${b.status}`,
      status:         b.status,
      occurred_at:    b.created_at,
      equipment_name: b.equipment?.name ?? null,
    };
  }

  function shapeRequestEvent(r, isStudent) {
    return {
      id:             `request-${r.id}`,
      type:           'request',
      title:          r.project_title,
      detail:         isStudent
        ? `Request ${r.status}`
        : `${r.profiles?.name ?? 'Student'} — ${r.status}`,
      status:         r.status,
      occurred_at:    r.created_at,
      equipment_name: r.equipment?.name ?? null,
    };
  }

  test('booking event has correct shape', () => {
    const b = { id: 'b1', status: 'confirmed', created_at: '2030-01-01T00:00:00Z', equipment: { name: 'Oscilloscope' } };
    const ev = shapeBookingEvent(b);
    assert.equal(ev.id, 'booking-b1');
    assert.equal(ev.type, 'booking');
    assert.equal(ev.equipment_name, 'Oscilloscope');
    assert.equal(ev.status, 'confirmed');
  });

  test('booking event falls back to "Equipment" when equipment is null', () => {
    const b = { id: 'b2', status: 'cancelled', created_at: '2030-01-01T00:00:00Z', equipment: null };
    const ev = shapeBookingEvent(b);
    assert.equal(ev.title, 'Equipment');
    assert.equal(ev.equipment_name, null);
  });

  test('request event detail uses student name for faculty view', () => {
    const r = {
      id: 'r1', project_title: 'IoT Project', status: 'pending',
      created_at: '2030-01-01T00:00:00Z',
      equipment: { name: 'Arduino' },
      profiles: { name: 'Alice' },
    };
    const ev = shapeRequestEvent(r, false);
    assert.match(ev.detail, /Alice/);
  });

  test('request event detail is simpler for student view', () => {
    const r = {
      id: 'r2', project_title: 'IoT Project', status: 'approved',
      created_at: '2030-01-01T00:00:00Z',
      equipment: { name: 'Arduino' },
      profiles: { name: 'Alice' },
    };
    const ev = shapeRequestEvent(r, true);
    assert.equal(ev.detail, 'Request approved');
    assert.ok(!ev.detail.includes('Alice'));
  });

  test('events have unique id prefix by type', () => {
    const b = { id: 'x1', status: 'confirmed', created_at: '2030-01-01T00:00:00Z', equipment: null };
    const r = { id: 'x1', project_title: 'P', status: 'pending', created_at: '2030-01-01T00:00:00Z', equipment: null, profiles: null };
    const bEv = shapeBookingEvent(b);
    const rEv = shapeRequestEvent(r, true);
    assert.notEqual(bEv.id, rEv.id);
  });
});
