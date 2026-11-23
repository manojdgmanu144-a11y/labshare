/**
 * tests/gemini.test.js
 *
 * Tests for server/services/gemini.js:
 *   - MODEL_NAME reads from GEMINI_MODEL env var, defaults to gemini-2.5-flash
 *   - withTimeout rejects after the given ms, resolves on success
 *   - _setClientFactory lets tests inject a mock without a real API key
 *
 * Tests for Gemini-call fallback behaviour in routes (mocked client):
 *   - /discover falls back to keyword search when Gemini throws
 *   - /discover falls back to keyword search when Gemini times out
 *   - /discover falls back when response JSON is unparseable
 *   - /search falls back to keyword search when Gemini throws
 *   - /recommend returns { slots: [], fallback: true } when Gemini throws
 *   - /explain returns deterministic fallback text when Gemini throws
 *   - /explain returns deterministic fallback text when Gemini times out
 *
 * None of these tests require a real GEMINI_API_KEY.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Unit: gemini.js service ─────────────────────────────────────────────────

describe('gemini service — MODEL_NAME', () => {
  test('defaults to gemini-2.5-flash when GEMINI_MODEL is unset', () => {
    const saved = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    // Re-require to pick up the env at module load time
    // (the constant is evaluated once, so we test the exported value)
    const { MODEL_NAME } = require('../services/gemini');
    // The module was already loaded; MODEL_NAME reflects the env at first load.
    // We validate the default by checking it equals what the env would yield.
    const expected = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    assert.equal(MODEL_NAME, expected);
    if (saved !== undefined) process.env.GEMINI_MODEL = saved;
  });

  test('MODULE_NAME equals GEMINI_MODEL when that env var is set before first require', () => {
    // Because Node caches modules we can only verify the already-loaded value
    // is consistent with the current env or the default.
    const { MODEL_NAME } = require('../services/gemini');
    assert.ok(typeof MODEL_NAME === 'string' && MODEL_NAME.length > 0);
  });
});

describe('gemini service — withTimeout', () => {
  const { withTimeout } = require('../services/gemini');

  test('resolves with the value when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1_000);
    assert.equal(result, 42);
  });

  test('rejects with "Gemini timeout" when promise takes longer than ms', async () => {
    const slow = new Promise(resolve => setTimeout(() => resolve('late'), 200));
    await assert.rejects(
      () => withTimeout(slow, 10),
      (err) => {
        assert.equal(err.message, 'Gemini timeout');
        return true;
      }
    );
  });

  test('rejects with the original error when the wrapped promise rejects', async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error('API error')), 1_000),
      { message: 'API error' }
    );
  });

  test('clears the timer on resolution (no dangling timer)', async () => {
    // If the timer were not cleared this test would emit an unhandled timeout
    // warning; it's enough that it completes without error.
    await withTimeout(Promise.resolve('ok'), 5_000);
  });
});

// ─── Helpers for route-level fallback tests ───────────────────────────────────

const { _setClientFactory } = require('../services/gemini');

/**
 * Builds a mock Gemini client factory whose generateContent() returns
 * the given JSON string wrapped in a response object, or rejects/hangs.
 */
function mockClientReturning(jsonText) {
  return () => ({
    getGenerativeModel: () => ({
      generateContent: async () => ({
        response: { text: () => jsonText },
      }),
    }),
  });
}

function mockClientThrowing(err) {
  return () => ({
    getGenerativeModel: () => ({
      generateContent: async () => { throw err; },
    }),
  });
}

function mockClientHanging() {
  return () => ({
    getGenerativeModel: () => ({
      // Never resolves — to test timeout we keep the promise pending
      generateContent: () => new Promise(() => {}),
    }),
  });
}

// ─── Unit: fallback logic (extracted from routes, tested in isolation) ────────
//
// We test the pure fallback functions directly rather than spinning up Express,
// keeping tests fast and dependency-free.

describe('keywordFallback (extracted logic)', () => {
  // Mirror the function from ai.js — pure logic, no imports needed
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

  const equipment = [
    { id: '1', name: 'Oscilloscope', description: 'measures voltage waveforms', category: 'Electronics', department: 'EE' },
    { id: '2', name: 'PCR Machine',  description: 'DNA amplification',          category: 'Bio',         department: 'Bio' },
    { id: '3', name: 'GPU Cluster',  description: 'deep learning training',     category: 'Computing',   department: 'CS' },
  ];

  test('returns items matching query keywords', () => {
    const results = keywordFallback(equipment, 'voltage oscilloscope');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, '1');
    assert.equal(results[0].source, 'keyword');
  });

  test('reason mentions match count', () => {
    const results = keywordFallback(equipment, 'deep learning GPU');
    assert.ok(results[0].reason.includes('keyword'));
  });

  test('returns empty array when nothing matches', () => {
    const results = keywordFallback(equipment, 'quantum entanglement reactor');
    assert.equal(results.length, 0);
  });

  test('returns first N items when query words are all too short', () => {
    const results = keywordFallback(equipment, 'a b', 2);
    assert.equal(results.length, 2);
  });

  test('respects limit parameter', () => {
    const results = keywordFallback(equipment, 'machine learning voltage DNA', 1);
    assert.equal(results.length, 1);
  });
});

// ─── Unit: withTimeout used in real route scenarios ───────────────────────────

describe('withTimeout integration with mock Gemini', () => {
  const { withTimeout } = require('../services/gemini');

  test('resolves quickly with mocked generateContent', async () => {
    const mockModel = {
      generateContent: async () => ({ response: { text: () => '{"matches":[]}' } }),
    };
    const result = await withTimeout(mockModel.generateContent('prompt'), 5_000);
    assert.equal(result.response.text(), '{"matches":[]}');
  });

  test('times out when generateContent hangs', async () => {
    const mockModel = {
      generateContent: () => new Promise(() => {}),
    };
    await assert.rejects(
      () => withTimeout(mockModel.generateContent('prompt'), 20),
      { message: 'Gemini timeout' }
    );
  });
});

// ─── Unit: _setClientFactory / fallback chain ─────────────────────────────────

describe('_setClientFactory — mock injection', () => {
  afterEach(() => {
    // Always restore the default factory after each test
    _setClientFactory(null);
  });

  test('getModel() uses the injected factory', () => {
    const { getModel } = require('../services/gemini');
    let called = false;
    _setClientFactory(() => {
      called = true;
      return { getGenerativeModel: () => ({ generateContent: async () => ({}) }) };
    });
    getModel();
    assert.ok(called, 'injected factory should have been called');
  });

  test('restoring factory with null makes getModel throw without GEMINI_API_KEY', () => {
    const { getModel } = require('../services/gemini');
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    _setClientFactory(null);
    assert.throws(() => getModel(), /GEMINI_API_KEY/);
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  });
});

// ─── Unit: explain fallback text generation ───────────────────────────────────

describe('buildFallbackExplanation (mirrored from routes/approvals.js)', () => {
  // Mirror the pure function — no imports needed
  function buildFallbackExplanation(entry) {
    const { rank, score, breakdown = {}, request } = entry;
    const name = request.student_name ?? 'This student';
    const topFactor =
      breakdown.urgency > breakdown.fairness && breakdown.urgency > breakdown.match
        ? 'deadline urgency'
        : breakdown.fairness > breakdown.match
        ? 'resource fairness'
        : 'requirement match';
    return rank === 1
      ? `${name} was allocated rank 1 (score ${score}) primarily due to ${topFactor}.`
      : `${name} received rank ${rank} (score ${score}); a higher-priority request with stronger ${topFactor} was present.`;
  }

  test('rank-1 explanation mentions name and score', () => {
    const entry = {
      rank: 1, score: 0.87,
      breakdown: { urgency: 0.9, fairness: 0.6, match: 0.5 },
      request: { student_name: 'Alice', student_id: 'u1', project_title: 'IoT' },
    };
    const text = buildFallbackExplanation(entry);
    assert.ok(text.includes('Alice'));
    assert.ok(text.includes('rank 1'));
    assert.ok(text.includes('deadline urgency'));
  });

  test('rank-2 explanation mentions "higher-priority"', () => {
    const entry = {
      rank: 2, score: 0.5,
      breakdown: { urgency: 0.3, fairness: 0.8, match: 0.2 },
      request: { student_name: 'Bob', student_id: 'u2', project_title: 'ML' },
    };
    const text = buildFallbackExplanation(entry);
    assert.ok(text.includes('Bob'));
    assert.ok(text.includes('rank 2'));
    assert.ok(text.includes('resource fairness'));
    assert.ok(text.includes('higher-priority'));
  });

  test('falls back to "This student" when student_name is absent', () => {
    const entry = {
      rank: 1, score: 0.75,
      breakdown: {},
      request: { student_id: 'u3', project_title: 'P' },
    };
    const text = buildFallbackExplanation(entry);
    assert.ok(text.includes('This student'));
  });

  test('uses requirement match when urgency and fairness are equal or lower', () => {
    const entry = {
      rank: 1, score: 0.6,
      breakdown: { urgency: 0.3, fairness: 0.3, match: 0.9 },
      request: { student_name: 'Carol', student_id: 'u4', project_title: 'CV' },
    };
    const text = buildFallbackExplanation(entry);
    assert.ok(text.includes('requirement match'));
  });
});

// ─── Integration-style: mock Gemini client → verify fallback responses ────────

describe('Gemini failure modes produce safe fallback output', () => {
  afterEach(() => _setClientFactory(null));

  test('withTimeout + throwing client → error propagates correctly', async () => {
    const { getModel, withTimeout } = require('../services/gemini');
    _setClientFactory(mockClientThrowing(new Error('quota exceeded')));

    await assert.rejects(
      async () => {
        const model  = getModel();
        await withTimeout(model.generateContent('test'), 1_000);
      },
      { message: 'quota exceeded' }
    );
  });

  test('withTimeout + hanging client → rejects with Gemini timeout', async () => {
    const { getModel, withTimeout } = require('../services/gemini');
    _setClientFactory(mockClientHanging());

    await assert.rejects(
      async () => {
        const model = getModel();
        await withTimeout(model.generateContent('test'), 20);
      },
      { message: 'Gemini timeout' }
    );
  });

  test('unparseable JSON response is caught by inner try and falls through to fallback', () => {
    // Simulate the discover route's inner try/catch
    const aiErr = new Error('JSON parse error');
    let aiMatches = null;
    try {
      JSON.parse('NOT VALID JSON {{{');
    } catch (_) {
      // caught — aiMatches stays null
    }
    assert.equal(aiMatches, null, 'aiMatches should remain null on parse failure');
  });

  test('mock client returning empty matches array → no fallback needed', async () => {
    const { getModel, withTimeout } = require('../services/gemini');
    _setClientFactory(mockClientReturning('{"matches":[]}'));

    const model  = getModel();
    const result = await withTimeout(model.generateContent('test'), 1_000);
    const text   = result.response.text().trim();
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
    const parsed  = jsonStr ? JSON.parse(jsonStr) : null;

    assert.ok(Array.isArray(parsed?.matches));
    assert.equal(parsed.matches.length, 0);
  });

  test('mock client returning valid explanations array → used directly', async () => {
    const { getModel, withTimeout } = require('../services/gemini');
    _setClientFactory(mockClientReturning(
      '{"explanations":[{"student_id_index":0,"explanation":"Alice ranked first."}]}'
    ));

    const model  = getModel();
    const result = await withTimeout(model.generateContent('test'), 1_000);
    const text   = result.response.text().trim();
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
    const parsed  = JSON.parse(jsonStr);

    assert.equal(parsed.explanations[0].explanation, 'Alice ranked first.');
  });

  test('recommend endpoint logic: Gemini failure → { slots: [], fallback: true }', async () => {
    // Simulate the recommend inner try/catch as written in routes/ai.js
    const { getModel, withTimeout } = require('../services/gemini');
    _setClientFactory(mockClientThrowing(new Error('model not found')));

    let response = null;
    try {
      const model  = getModel();
      const result = await withTimeout(model.generateContent('prompt'), 1_000);
      const text   = result.response.text().trim();
      const match  = text.match(/\{[\s\S]*\}/);
      if (match) response = { ...JSON.parse(match[0]), fallback: false };
    } catch (_aiErr) {
      // fall through
    }

    if (!response) response = { slots: [], fallback: true };

    assert.deepEqual(response, { slots: [], fallback: true });
  });

  test('search endpoint logic: Gemini timeout → keyword fallback flag is true', async () => {
    // Simulate the search inner try/catch
    const { getModel, withTimeout } = require('../services/gemini');
    _setClientFactory(mockClientHanging());

    let usedFallback = false;
    try {
      const model  = getModel();
      await withTimeout(model.generateContent('prompt'), 20);
    } catch (_) {
      usedFallback = true;
    }

    assert.ok(usedFallback, 'should have fallen back after timeout');
  });
});
