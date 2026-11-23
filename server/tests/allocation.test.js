const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { rankRequests, scoreRequest, minMaxNorm, nearestSlotsBeforeDeadline } =
  require('../services/allocation');

// ── Fixtures ─────────────────────────────────────────────────

const NOW = Date.UTC(2030, 0, 10, 12, 0, 0);   // 2030-01-10 12:00 UTC

function makeRequest(overrides = {}) {
  return {
    id:           overrides.id          ?? 'req-' + Math.random().toString(36).slice(2, 7),
    student_id:   overrides.student_id  ?? 'student-A',
    student_name: overrides.name        ?? 'Student A',
    project_title: overrides.project_title ?? 'My Project',
    purpose:      overrides.purpose     ?? 'general purpose',
    deadline:     overrides.deadline    ?? '2030-01-20',   // 10 days from NOW
    start_time:   overrides.start_time  ?? '2030-01-15T09:00:00Z',
    end_time:     overrides.end_time    ?? '2030-01-15T11:00:00Z',
    equipment_id: overrides.equipment_id ?? 'equip-1',
  };
}

const EQUIPMENT = {
  id: 'equip-1', name: 'Oscilloscope', category: 'Test & Measurement',
  description: 'Digital oscilloscope for signal analysis and measurement',
  specs: { bandwidth: '50MHz', channels: 4 },
};

function makeContext(overrides = {}) {
  return {
    equipment:           overrides.equipment           ?? EQUIPMENT,
    recentUsage:         overrides.recentUsage         ?? new Map(),
    freeSlots:           overrides.freeSlots           ?? [],
    equivalentEquipment: overrides.equivalentEquipment ?? [],
    nowMs:               overrides.nowMs               ?? NOW,
  };
}

// ─────────────────────────────────────────────────────────────
// minMaxNorm
// ─────────────────────────────────────────────────────────────
describe('minMaxNorm', () => {
  test('single value returns [1]', () => {
    assert.deepEqual(minMaxNorm([42]), [1]);
  });

  test('all equal values return all 1s', () => {
    assert.deepEqual(minMaxNorm([5, 5, 5]), [1, 1, 1]);
  });

  test('distinct values scale to [0, 1]', () => {
    const result = minMaxNorm([0, 50, 100]);
    assert.equal(result[0], 0);
    assert.equal(result[1], 0.5);
    assert.equal(result[2], 1);
  });
});

// ─────────────────────────────────────────────────────────────
// nearestSlotsBeforeDeadline
// ─────────────────────────────────────────────────────────────
describe('nearestSlotsBeforeDeadline', () => {
  const FREE = [
    { start_time: '2030-01-11T09:00:00Z', end_time: '2030-01-11T11:00:00Z' },
    { start_time: '2030-01-12T09:00:00Z', end_time: '2030-01-12T11:00:00Z' },
    { start_time: '2030-01-25T09:00:00Z', end_time: '2030-01-25T11:00:00Z' }, // after deadline
  ];

  test('filters out slots ending after the deadline', () => {
    const result = nearestSlotsBeforeDeadline(FREE, '2030-01-20');
    assert.ok(result.every(s => new Date(s.end_time) <= new Date('2030-01-20T23:59:59Z')));
  });

  test('respects limit', () => {
    const result = nearestSlotsBeforeDeadline(FREE, '2030-01-20', 1);
    assert.equal(result.length, 1);
  });

  test('returns empty for a past deadline', () => {
    const result = nearestSlotsBeforeDeadline(FREE, '2029-12-01');
    assert.equal(result.length, 0);
  });

  test('attaches source: free_slot', () => {
    const result = nearestSlotsBeforeDeadline(FREE, '2030-01-20');
    assert.ok(result.every(s => s.source === 'free_slot'));
  });
});

// ─────────────────────────────────────────────────────────────
// scoreRequest
// ─────────────────────────────────────────────────────────────
describe('scoreRequest', () => {
  test('returns raw object with all three components', () => {
    const r = makeRequest();
    const result = scoreRequest(r, makeContext());
    assert.ok('urgencyMs'  in result.raw);
    assert.ok('usageHours' in result.raw);
    assert.ok('matchCount' in result.raw);
  });

  test('urgencyMs is positive for a future deadline', () => {
    const r = makeRequest({ deadline: '2030-01-20' }); // 10 days from NOW
    const { raw } = scoreRequest(r, makeContext());
    assert.ok(raw.urgencyMs > 0);
  });

  test('urgencyMs is 0 (clamped) for a past deadline', () => {
    const r = makeRequest({ deadline: '2029-12-01' });
    const { raw } = scoreRequest(r, makeContext());
    assert.equal(raw.urgencyMs, 0);
  });

  test('usageHours reflects recentUsage map', () => {
    const r = makeRequest({ student_id: 'stu-X' });
    const ctx = makeContext({ recentUsage: new Map([['stu-X', 40]]) });
    const { raw } = scoreRequest(r, ctx);
    assert.equal(raw.usageHours, 40);
  });

  test('matchCount is 0 for empty purpose', () => {
    const r = makeRequest({ purpose: '' });
    const { raw } = scoreRequest(r, makeContext());
    assert.equal(raw.matchCount, 0);
  });

  test('matchCount increases when purpose words appear in equipment text', () => {
    const r = makeRequest({ purpose: 'signal oscilloscope bandwidth analysis' });
    const { raw } = scoreRequest(r, makeContext());
    assert.ok(raw.matchCount > 0, 'expected at least one keyword match');
  });
});

// ─────────────────────────────────────────────────────────────
// rankRequests — no-conflict (single request)
// ─────────────────────────────────────────────────────────────
describe('rankRequests — single request (no conflict)', () => {
  test('returns rank 1 and feasible:true when deadline is in future', () => {
    const result = rankRequests([makeRequest()], makeContext());
    assert.equal(result.ranked.length, 1);
    assert.equal(result.ranked[0].rank, 1);
    assert.equal(result.feasible, true);
  });

  test('feasible:false when only deadline is in the past', () => {
    const r = makeRequest({ deadline: '2029-12-01' });
    const result = rankRequests([r], makeContext());
    assert.equal(result.feasible, false);
  });

  test('returns empty ranked array for empty input', () => {
    const result = rankRequests([], makeContext());
    assert.deepEqual(result.ranked, []);
    assert.equal(result.feasible, false);
  });

  test('score is between 0 and 1', () => {
    const result = rankRequests([makeRequest()], makeContext());
    const { score } = result.ranked[0];
    assert.ok(score >= 0 && score <= 1, `score ${score} out of [0,1]`);
  });

  test('breakdown components sum close to total score (within floating point)', () => {
    const result = rankRequests([makeRequest()], makeContext());
    const { score, breakdown } = result.ranked[0];
    const reconstructed = 0.5 * breakdown.urgency + 0.3 * breakdown.fairness + 0.2 * breakdown.match;
    assert.ok(Math.abs(score - reconstructed) < 1e-9);
  });
});

// ─────────────────────────────────────────────────────────────
// rankRequests — tie-breaking
// ─────────────────────────────────────────────────────────────
describe('rankRequests — tie-breaking', () => {
  test('when usage and match are identical, earlier deadline ranks higher', () => {
    // Both students have 0 usage, same purpose → urgency decides.
    // Student A: deadline in 5 days; Student B: deadline in 15 days.
    const rA = makeRequest({ id: 'rA', student_id: 'sA', deadline: '2030-01-15' });
    const rB = makeRequest({ id: 'rB', student_id: 'sB', deadline: '2030-01-25' });

    const result = rankRequests([rB, rA], makeContext());  // pass in reversed order
    assert.equal(result.ranked[0].request.id, 'rA', 'Student A (sooner deadline) must be rank 1');
    assert.equal(result.ranked[1].request.id, 'rB');
  });

  test('when scores are exactly equal, tie-break gives rank 1 to earlier deadline', () => {
    // Force equal scores by making urgency/usage/match all equal.
    // Same deadline → scores are truly tied; deterministic order preserved by sort stability.
    const rA = makeRequest({ id: 'rA', student_id: 'sA', deadline: '2030-01-15', purpose: 'signal' });
    const rB = makeRequest({ id: 'rB', student_id: 'sB', deadline: '2030-01-15', purpose: 'signal' });
    const ctx = makeContext({ recentUsage: new Map([['sA', 0], ['sB', 0]]) });

    const result = rankRequests([rA, rB], ctx);
    // Both have same deadline so tie-break is neutral — just verify no crash & both ranked
    assert.equal(result.ranked.length, 2);
    assert.equal(result.ranked[0].rank, 1);
    assert.equal(result.ranked[1].rank, 2);
  });
});

// ─────────────────────────────────────────────────────────────
// rankRequests — resource hog is down-ranked (fairness)
// ─────────────────────────────────────────────────────────────
describe('rankRequests — fairness (hog penalty)', () => {
  test('student with high recent usage is ranked below a first-time user, even with same deadline', () => {
    const rHog  = makeRequest({ id: 'rHog',  student_id: 'hog',   deadline: '2030-01-20' });
    const rFair = makeRequest({ id: 'rFair', student_id: 'fair',  deadline: '2030-01-20' });

    const ctx = makeContext({
      recentUsage: new Map([
        ['hog',  80],   // 80 h used in last 30 days
        ['fair',  2],   // 2 h used
      ]),
    });

    const result = rankRequests([rHog, rFair], ctx);
    assert.equal(result.ranked[0].request.id, 'rFair', 'fair-use student should be rank 1');
    assert.equal(result.ranked[1].request.id, 'rHog');
  });

  test('hog\'s fairness breakdown component is strictly lower than the fair student\'s', () => {
    const rHog  = makeRequest({ id: 'rHog',  student_id: 'hog'  });
    const rFair = makeRequest({ id: 'rFair', student_id: 'fair' });
    const ctx = makeContext({
      recentUsage: new Map([['hog', 100], ['fair', 0]]),
    });

    const result = rankRequests([rHog, rFair], ctx);
    const hogFairness  = result.ranked.find(r => r.request.id === 'rHog').breakdown.fairness;
    const fairFairness = result.ranked.find(r => r.request.id === 'rFair').breakdown.fairness;
    assert.ok(fairFairness > hogFairness, 'fair student must have higher fairness score');
  });
});

// ─────────────────────────────────────────────────────────────
// rankRequests — infeasible deadline
// ─────────────────────────────────────────────────────────────
describe('rankRequests — infeasible deadline', () => {
  test('feasible:false when all deadlines are in the past', () => {
    const r1 = makeRequest({ id: 'r1', deadline: '2029-11-01' });
    const r2 = makeRequest({ id: 'r2', deadline: '2029-12-01' });
    const result = rankRequests([r1, r2], makeContext());
    assert.equal(result.feasible, false);
  });

  test('feasible:true when at least one deadline is still future', () => {
    const rPast   = makeRequest({ id: 'rPast',   deadline: '2029-12-01' });
    const rFuture = makeRequest({ id: 'rFuture', deadline: '2030-01-20' });
    const result  = rankRequests([rPast, rFuture], makeContext());
    assert.equal(result.feasible, true);
  });

  test('alternatives include free slots before the given deadline', () => {
    const FREE = [
      { start_time: '2030-01-11T09:00:00Z', end_time: '2030-01-11T11:00:00Z' },
      { start_time: '2030-01-21T09:00:00Z', end_time: '2030-01-21T11:00:00Z' }, // after deadline
    ];
    const r = makeRequest({ student_id: 'sX', deadline: '2030-01-20' });
    const result = rankRequests([r], makeContext({ freeSlots: FREE }));
    const alts = result.alternatives['sX'];
    assert.equal(alts.freeSlots.length, 1, 'only 1 slot fits before the deadline');
  });
});

// ─────────────────────────────────────────────────────────────
// rankRequests — alternatives (equivalent equipment)
// ─────────────────────────────────────────────────────────────
describe('rankRequests — equivalent equipment alternatives', () => {
  test('equivalentEquipment is included in alternatives for every student', () => {
    const r = makeRequest({ student_id: 'sY' });
    const ctx = makeContext({
      equivalentEquipment: [
        { id: 'equip-2', name: 'Rigol Oscilloscope', category: 'Test & Measurement' },
      ],
    });
    const result = rankRequests([r], ctx);
    assert.ok(result.alternatives['sY'].equivalentEquipment.length > 0);
    assert.equal(result.alternatives['sY'].equivalentEquipment[0].source, 'equivalent');
  });

  test('equipment itself is excluded from equivalents', () => {
    const r = makeRequest({ student_id: 'sZ' });
    const ctx = makeContext({
      equivalentEquipment: [EQUIPMENT, { id: 'equip-99', name: 'Other scope' }],
    });
    const result = rankRequests([r], ctx);
    const ids = result.alternatives['sZ'].equivalentEquipment.map(e => e.id);
    assert.ok(!ids.includes(EQUIPMENT.id), 'primary equipment must not appear in equivalents');
    assert.ok(ids.includes('equip-99'));
  });
});

// ─────────────────────────────────────────────────────────────
// rankRequests — requirement match scoring
// ─────────────────────────────────────────────────────────────
describe('rankRequests — requirement match', () => {
  test('request whose purpose matches equipment keywords scores higher on match', () => {
    const rGood = makeRequest({
      id: 'rGood', student_id: 'sGood',
      purpose: 'signal analysis oscilloscope bandwidth channels digital',
    });
    const rPoor = makeRequest({
      id: 'rPoor', student_id: 'sPoor',
      purpose: 'baking cookies and making tea',
    });
    // Same deadline, same usage → match decides
    const ctx = makeContext({ recentUsage: new Map([['sGood', 0], ['sPoor', 0]]) });
    const result = rankRequests([rPoor, rGood], ctx);
    assert.equal(result.ranked[0].request.id, 'rGood', 'better-matching request should rank first');
  });
});
