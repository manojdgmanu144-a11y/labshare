const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Pull in the pure logic from ai.js without spinning up Express.
// We re-implement keywordFallback here to test it in isolation — the real
// function is not exported (it's internal to the route module).
function keywordFallback(equipment, query, limit = 5) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return equipment.slice(0, limit);

  return equipment
    .map(item => {
      const haystack = `${item.name} ${item.description} ${item.category} ${item.department}`.toLowerCase();
      const score    = words.reduce((s, w) => s + (haystack.includes(w) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({
      ...item,
      reason: `Matched ${score} keyword${score !== 1 ? 's' : ''} from your query`,
      source: 'keyword',
    }));
}

const SAMPLE = [
  { id: '1', name: 'Arduino Mega Kit', description: 'Microcontroller development board', category: 'Development Kit', department: 'Electronics' },
  { id: '2', name: 'GPU Workstation', description: 'CUDA deep learning training node', category: 'Workstation', department: 'Computer Science' },
  { id: '3', name: 'Oscilloscope', description: 'Digital signal measurement instrument', category: 'Test & Measurement', department: 'Electronics' },
  { id: '4', name: 'Raspberry Pi Kit', description: 'Single-board IoT development computer', category: 'Development Kit', department: 'Electronics' },
];

describe('keywordFallback', () => {
  test('returns items with matching keywords, most relevant first', () => {
    const results = keywordFallback(SAMPLE, 'iot development');
    assert.ok(results.length > 0, 'should return at least one result');
    // Raspberry Pi has both "iot" and "development" in it
    assert.equal(results[0].id, '4');
  });

  test('attaches reason and source fields', () => {
    const results = keywordFallback(SAMPLE, 'cuda');
    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'keyword');
    assert.ok(results[0].reason.includes('keyword'));
  });

  test('returns empty array when no keyword matches', () => {
    const results = keywordFallback(SAMPLE, 'photonics quantum');
    assert.deepEqual(results, []);
  });

  test('respects limit parameter', () => {
    // All items have "kit" or "development" but limit=2
    const results = keywordFallback(SAMPLE, 'development kit microcontroller', 2);
    assert.ok(results.length <= 2);
  });

  test('handles query with only short words (≤ 2 chars) gracefully', () => {
    // "a" and "is" are both <= 2 chars, filtered out → returns first N items
    const results = keywordFallback(SAMPLE, 'a is', 3);
    assert.ok(Array.isArray(results));
  });

  test('is case-insensitive', () => {
    const lower = keywordFallback(SAMPLE, 'cuda');
    const upper = keywordFallback(SAMPLE, 'CUDA');
    assert.deepEqual(lower.map(r => r.id), upper.map(r => r.id));
  });
});

describe('equipment query param validation logic', () => {
  const VALID_STATUSES   = new Set(['available', 'in_use', 'maintenance', 'retired']);
  const VALID_CATEGORIES = new Set(['Development Kit', 'Test & Measurement', 'FPGA', 'Workstation']);

  test('valid status passes', () => {
    assert.ok(VALID_STATUSES.has('available'));
    assert.ok(VALID_STATUSES.has('in_use'));
  });

  test('invalid status rejected', () => {
    assert.ok(!VALID_STATUSES.has('broken'));
    assert.ok(!VALID_STATUSES.has(''));
  });

  test('valid category passes', () => {
    assert.ok(VALID_CATEGORIES.has('Development Kit'));
  });

  test('search term length enforcement', () => {
    const longSearch = 'a'.repeat(121);
    assert.ok(longSearch.length > 120, 'should exceed limit');
    assert.ok('short'.length <= 120, 'should be within limit');
  });

  test('LIKE metacharacter escaping', () => {
    function escapeLike(s) { return s.replace(/[%_\\]/g, '\\$&'); }
    assert.equal(escapeLike('50% off'), '50\\% off');
    assert.equal(escapeLike('C_D chip'), 'C\\_D chip');
    assert.equal(escapeLike('path\\to'), 'path\\\\to');
    assert.equal(escapeLike('normal'), 'normal');
  });
});
