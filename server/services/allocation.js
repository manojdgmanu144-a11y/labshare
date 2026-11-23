/**
 * server/services/allocation.js
 *
 * Pure, deterministic allocation engine — NO database or network calls.
 * All inputs are plain JS values; all outputs are plain JS objects.
 *
 * Exported functions:
 *   scoreRequest(request, context)  → ScoredRequest
 *   rankRequests(requests, context) → RankedResult
 *
 * ─────────────────────────────────────────────────────────────
 * Scoring model  (weights must sum to 1.0)
 * ─────────────────────────────────────────────────────────────
 *   deadline urgency   50%  — sooner deadline = higher score
 *   fairness           30%  — fewer hours used by student
 *                             in last 30 days = higher score
 *   requirement match  20%  — keyword overlap between purpose
 *                             and equipment specs/description
 *
 * Each component is normalised to [0, 1] within the competing set
 * before weighting so comparisons are always relative.
 *
 * ─────────────────────────────────────────────────────────────
 * Input shapes
 * ─────────────────────────────────────────────────────────────
 * request  — one entry from access_requests
 *   { id, student_id, student_name, project_title, purpose,
 *     deadline, start_time, end_time, equipment_id }
 *
 * context  — per-call data the route layer fetches once
 *   { equipment, recentUsage, freeSlots, equivalentEquipment }
 *
 *   equipment           — { id, name, category, description, specs }
 *   recentUsage         — Map<student_id, number> (hours in last 30 days)
 *   freeSlots           — Array<{start_time, end_time}> free on this equip.
 *   equivalentEquipment — Array<{id, name}> same category, different unit
 */

'use strict';

const WEIGHTS = { urgency: 0.5, fairness: 0.3, match: 0.2 };

// ── Component scorers (each returns 0–1 raw value) ──────────

/**
 * Deadline urgency raw score for a single request.
 * Returns milliseconds until deadline (less = more urgent).
 * We store the raw ms here and normalise across the set later.
 */
function rawUrgency(request, nowMs) {
  const deadlineMs = Date.parse(request.deadline + 'T23:59:59Z');
  if (isNaN(deadlineMs)) return 0;
  // Clamp so past deadlines don't go negative — they should still rank
  return Math.max(0, deadlineMs - nowMs);
}

/**
 * Recent usage raw value for a student: hours used in last 30 days.
 * Lower hours = higher fairness.  Stored as-is; normalised later.
 */
function rawUsage(studentId, recentUsage) {
  return recentUsage.get(studentId) ?? 0;
}

/**
 * Requirement match: count keyword overlaps between purpose text
 * and the equipment's description + flattened specs JSON.
 * Returns integer word-match count; normalised later.
 */
function rawMatch(purpose, equipment) {
  if (!purpose || !equipment) return 0;
  const specsText = typeof equipment.specs === 'object'
    ? JSON.stringify(equipment.specs)
    : String(equipment.specs ?? '');
  const haystack = `${equipment.description ?? ''} ${specsText}`.toLowerCase();

  const words = purpose
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3);   // skip short stop-words

  if (words.length === 0) return 0;
  return words.reduce((count, w) => count + (haystack.includes(w) ? 1 : 0), 0);
}

// ── Normalisation helper ─────────────────────────────────────

/**
 * Given an array of raw numeric values, return an equal-length array where
 * each is normalised to [0, 1] using min-max scaling.
 * When all values are equal the normalised value is 1 (full score — no
 * penalty for a solo contender or tied field).
 */
function minMaxNorm(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map(v => (v - min) / (max - min));
}

// ── Free-slot alternatives ───────────────────────────────────

/**
 * Given a list of free slots and a request's deadline, return the
 * nearest slots that fit before the deadline (up to `limit`).
 *
 * freeSlots: Array<{ start_time: string, end_time: string }>
 * Returns:   Array<{ start_time, end_time, source: 'free_slot' }>
 */
function nearestSlotsBeforeDeadline(freeSlots, deadline, limit = 3) {
  const deadlineMs = Date.parse(deadline + 'T23:59:59Z');
  if (isNaN(deadlineMs)) return [];

  return freeSlots
    .filter(s => {
      const endMs = Date.parse(s.end_time);
      return !isNaN(endMs) && endMs <= deadlineMs;
    })
    .slice(0, limit)
    .map(s => ({ ...s, source: 'free_slot' }));
}

// ── Main exports ─────────────────────────────────────────────

/**
 * scoreRequest — compute all three raw component values for a single request.
 * This is a pure helper; normalisation happens across the full set in rankRequests.
 *
 * Returns:
 *   { request, raw: { urgencyMs, usageHours, matchCount } }
 */
function scoreRequest(request, context) {
  const nowMs = context.nowMs ?? Date.now();
  return {
    request,
    raw: {
      urgencyMs:  rawUrgency(request, nowMs),
      usageHours: rawUsage(request.student_id, context.recentUsage ?? new Map()),
      matchCount: rawMatch(request.purpose, context.equipment),
    },
  };
}

/**
 * rankRequests — score and rank a competing set of requests.
 *
 * @param {Array}  requests  — 1 or more access_request objects for the
 *                             same equipment + overlapping time window
 * @param {Object} context   — { equipment, recentUsage, freeSlots,
 *                               equivalentEquipment, nowMs? }
 * @returns {RankedResult}
 *   {
 *     ranked: [
 *       { rank, request, score, breakdown: {urgency,fairness,match} }
 *     ],
 *     alternatives: {
 *       [student_id]: {
 *         freeSlots:            Array<slot>   — nearest slots before deadline
 *         equivalentEquipment:  Array<equip>  — same-category alternatives
 *       }
 *     },
 *     feasible: boolean   — true if ≥1 request fits before its deadline
 *   }
 */
function rankRequests(requests, context) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return { ranked: [], alternatives: {}, feasible: false };
  }

  const nowMs      = context.nowMs ?? Date.now();
  const equipment  = context.equipment ?? {};
  const freeSlots  = context.freeSlots  ?? [];
  const equivEquip = context.equivalentEquipment ?? [];

  // ── 1. Compute raw scores ──────────────────────────────────
  const scored = requests.map(r => scoreRequest(r, { ...context, nowMs }));

  // ── 2. Normalise each dimension across the set ────────────
  const urgencyNorm  = minMaxNorm(scored.map(s => s.raw.urgencyMs));
  const usageNorm    = minMaxNorm(scored.map(s => s.raw.usageHours));
  const matchNorm    = minMaxNorm(scored.map(s => s.raw.matchCount));

  // Urgency: *less* time until deadline = higher score → invert
  // usageNorm: *more* usage = lower fairness → invert
  const ranked = scored.map((s, i) => {
    const urgency  = 1 - urgencyNorm[i];   // sooner deadline → higher
    const fairness = 1 - usageNorm[i];     // less usage      → higher
    const match    = matchNorm[i];          // more keywords   → higher

    const score = (
      WEIGHTS.urgency  * urgency  +
      WEIGHTS.fairness * fairness +
      WEIGHTS.match    * match
    );

    return {
      request:   s.request,
      score:     Math.round(score * 10000) / 10000,  // 4 d.p.
      breakdown: {
        urgency:  Math.round(urgency  * 10000) / 10000,
        fairness: Math.round(fairness * 10000) / 10000,
        match:    Math.round(match    * 10000) / 10000,
      },
    };
  });

  // ── 3. Sort: descending score; tie-break by earlier deadline ──
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: earlier deadline wins (more urgent)
    return Date.parse(a.request.deadline) - Date.parse(b.request.deadline);
  });

  // ── 4. Assign ranks (1-based) ─────────────────────────────
  ranked.forEach((r, i) => { r.rank = i + 1; });

  // ── 5. Feasibility: at least one request's deadline is in the future ──
  const feasible = ranked.some(r => Date.parse(r.request.deadline + 'T23:59:59Z') > nowMs);

  // ── 6. Build alternatives for lower-ranked students ───────
  //       (always built for every student so callers can present options)
  const alternatives = {};
  for (const r of ranked) {
    const sid = r.request.student_id;
    alternatives[sid] = {
      freeSlots: nearestSlotsBeforeDeadline(freeSlots, r.request.deadline),
      equivalentEquipment: equivEquip
        .filter(e => e.id !== equipment.id)
        .map(e => ({ id: e.id, name: e.name, source: 'equivalent' })),
    };
  }

  return { ranked, alternatives, feasible };
}

module.exports = { scoreRequest, rankRequests, minMaxNorm, nearestSlotsBeforeDeadline };
