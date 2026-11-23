const express                       = require('express');
const router                        = express.Router();
const { getModel, withTimeout }     = require('../services/gemini');
const supabase                      = require('../services/supabase');
const { authenticate }              = require('../middleware/auth');
const { requireRole }               = require('../middleware/roles');
const { requireString, sanitiseError } = require('../utils/validate');

const DISCOVER_MAX_CHARS = 300;

/**
 * Keyword fallback: score each item by how many words from the query appear
 * in its name + description + category (case-insensitive).
 * Returns up to `limit` items sorted by score descending, score > 0 only.
 */
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

/**
 * POST /api/ai/discover
 * Body: { need: string (max 300 chars) }
 * Returns: { results: [{ id, name, ..., reason, source }], fallback: bool }
 *
 * "source" is "ai" or "keyword" so the client can display a fallback notice.
 * The Gemini API key is used only here on the server — never sent to the client.
 */
router.post('/discover', authenticate, async (req, res) => {
  try {
    const need = requireString(req.body.need, 'need');
    if (need.length > DISCOVER_MAX_CHARS) {
      return res.status(400).json({
        error: `need must be ${DISCOVER_MAX_CHARS} characters or fewer (got ${need.length})`,
      });
    }

    // Fetch available equipment — server-side only, never streamed to client raw
    const { data: equipment, error: dbErr } = await supabase
      .from('equipment')
      .select('id, name, category, department, location, description, status')
      .eq('status', 'available');
    if (dbErr) throw dbErr;

    if (equipment.length === 0) {
      return res.json({ results: [], fallback: false });
    }

    // Build a compact representation to keep the prompt small
    const equipmentSummary = equipment.map(e => ({
      id: e.id, name: e.name, category: e.category,
      department: e.department, description: e.description.slice(0, 120),
    }));

    const prompt = `You are a university lab equipment assistant helping students find the right equipment.

A student has described their need:
"${need}"

Available equipment (JSON):
${JSON.stringify(equipmentSummary)}

Task: Identify the best matching equipment items (up to 5). For each match provide a one-sentence reason why it fits the student's need.

Rules:
- Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON.
- Format: { "matches": [ { "id": "<uuid>", "reason": "<one sentence>" }, ... ] }
- Order by relevance, most relevant first.
- If nothing matches, return { "matches": [] }.`;

    let aiMatches = null;
    try {
      const model  = getModel();
      const result = await withTimeout(model.generateContent(prompt));
      const text   = result.response.text().trim();
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.matches)) aiMatches = parsed.matches;
      }
    } catch (_aiErr) {
      // Gemini unavailable or returned unparseable output — fall through to keyword
    }

    if (aiMatches) {
      const results = aiMatches
        .filter(m => m && typeof m.id === 'string' && typeof m.reason === 'string')
        .slice(0, 5)
        .map(m => {
          const item = equipment.find(e => e.id === m.id);
          if (!item) return null;
          return { ...item, reason: m.reason, source: 'ai' };
        })
        .filter(Boolean);

      return res.json({ results, fallback: false });
    }

    // Graceful degradation — keyword search
    return res.json({ results: keywordFallback(equipment, need), fallback: true });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

// POST /api/ai/search — kept for backwards compatibility (dashboard)
router.post('/search', authenticate, async (req, res) => {
  try {
    const query = requireString(req.body.query, 'query');
    if (query.length > 500) {
      return res.status(400).json({ error: 'query must be 500 characters or fewer' });
    }

    const { data: equipment, error } = await supabase
      .from('equipment').select('id, name, category, department, description, specs, status')
      .eq('status', 'available');
    if (error) throw error;

    const prompt = `You are a university lab equipment assistant.
Given the following equipment list (JSON), identify the top 5 most relevant items for the student's query.
Return ONLY a valid JSON array of equipment IDs in order of relevance, e.g. ["uuid1","uuid2"].
Do not include any explanation.

Equipment:
${JSON.stringify(equipment)}

Student query: "${query}"`;

    try {
      const model  = getModel();
      const result = await withTimeout(model.generateContent(prompt));
      const text   = result.response.text().trim();
      const match  = text.match(/\[[\s\S]*\]/);
      if (match) {
        const ids     = JSON.parse(match[0]);
        const ordered = ids.map(id => equipment.find(e => e.id === id)).filter(Boolean);
        return res.json({ results: ordered, fallback: false });
      }
    } catch (_aiErr) {
      // Gemini unavailable or timed out — fall through to keyword fallback
    }

    // Graceful degradation — keyword search
    return res.json({ results: keywordFallback(equipment, query), fallback: true });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

// POST /api/ai/recommend — conflict-aware slot recommendation
router.post('/recommend', authenticate, async (req, res) => {
  try {
    const equipment_id  = requireString(req.body.equipment_id,  'equipment_id');
    const project_title = requireString(req.body.project_title, 'project_title');
    const deadline      = requireString(req.body.deadline,      'deadline');
    const duration_hours = Number(req.body.duration_hours);

    if (!Number.isFinite(duration_hours) || duration_hours <= 0 || duration_hours > 72) {
      return res.status(400).json({ error: 'duration_hours must be a number between 1 and 72' });
    }

    // Fetch existing confirmed bookings for this equipment
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('start_time, end_time')
      .eq('equipment_id', equipment_id)
      .eq('status', 'confirmed')
      .gte('end_time', new Date().toISOString())
      .order('start_time');
    if (error) throw error;

    const now    = new Date().toISOString();
    const prompt = `You are a university lab scheduling assistant.
A student needs to book equipment for their project.

Project: "${project_title}"
Deadline: ${deadline}
Required duration: ${duration_hours} hour(s)
Current time: ${now}

Existing confirmed bookings (UTC):
${JSON.stringify(bookings)}

Suggest 3 non-overlapping time slots (each ${duration_hours} h) that:
1. Fit before the deadline
2. Do not overlap with existing bookings
3. Are distributed fairly (not all at awkward hours)

Return ONLY valid JSON: { "slots": [{"start":"ISO","end":"ISO","reason":"short reason"}, ...] }`;

    try {
      const model  = getModel();
      const result = await withTimeout(model.generateContent(prompt));
      const text   = result.response.text().trim();
      const match  = text.match(/\{[\s\S]*\}/);
      if (match) return res.json({ ...JSON.parse(match[0]), fallback: false });
    } catch (_aiErr) {
      // Gemini unavailable or timed out — return empty slots so the client
      // can fall back to its own free-slot list
    }

    res.json({ slots: [], fallback: true });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

/**
 * POST /api/ai/explain
 * Faculty/admin only.
 *
 * Body: { ranked: RankedResult.ranked }  — the output of rankRequests(), verbatim.
 *
 * The AI is given the ALREADY-RANKED list and asked to write a plain-language
 * justification for each student.  It MUST NOT reorder; the server enforces
 * this by ignoring any ordering information in the AI response and re-attaching
 * explanations by student_id lookup.
 *
 * Returns:
 *   { explanations: [ { student_id, student_name, rank, score, explanation } ] }
 *
 * On Gemini failure returns a deterministic fallback built entirely from the
 * score breakdown — no AI required.
 */
router.post('/explain', authenticate, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { ranked } = req.body;

    if (!Array.isArray(ranked) || ranked.length === 0) {
      return res.status(400).json({ error: 'ranked must be a non-empty array' });
    }
    if (ranked.length > 20) {
      return res.status(400).json({ error: 'ranked may contain at most 20 entries' });
    }

    // Validate each entry has the minimum expected shape
    for (const entry of ranked) {
      if (
        typeof entry.rank     !== 'number' ||
        typeof entry.score    !== 'number' ||
        !entry.request        ||
        typeof entry.request.student_id !== 'string'
      ) {
        return res.status(400).json({ error: 'Each ranked entry must have rank, score, and request.student_id' });
      }
    }

    // ── Build a compact summary for the prompt (no PII beyond names) ──
    const summary = ranked.map(r => ({
      rank:          r.rank,
      student:       r.request.student_name ?? r.request.student_id,
      project:       r.request.project_title,
      deadline:      r.request.deadline,
      score:         r.score,
      urgency_score: r.breakdown?.urgency  ?? 0,
      fairness_score: r.breakdown?.fairness ?? 0,
      match_score:   r.breakdown?.match    ?? 0,
    }));

    const prompt = `You are a university lab allocation system explaining scheduling decisions to faculty.

The allocation algorithm has already ranked these access requests using a weighted score:
  - Deadline urgency (50%): sooner deadlines rank higher
  - Fairness (30%): students who have used less equipment recently rank higher
  - Requirement match (20%): how well the project purpose matches the equipment specs

Ranked results:
${JSON.stringify(summary, null, 2)}

Task: Write a SHORT (1–2 sentence) plain-language explanation for each student explaining why they received their rank.
  - Be factual, refer to the actual scores.
  - Do NOT suggest a different ranking.
  - Do NOT use jargon or mention weights.
  - Address the student by name.

Return ONLY valid JSON — no markdown, no code fences:
{
  "explanations": [
    { "student_id_index": 0, "explanation": "..." },
    ...
  ]
}

The student_id_index is the 0-based position in the ranked array above (0 = rank 1).`;

    // ── Call Gemini (inner try — failure falls through to deterministic fallback) ──
    let aiExplanations = null;
    try {
      const model  = getModel();
      const result = await withTimeout(model.generateContent(prompt));
      const text   = result.response.text().trim();
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.explanations)) {
          aiExplanations = parsed.explanations;
        }
      }
    } catch (_aiErr) {
      // Fall through to deterministic fallback
    }

    // ── Deterministic fallback: build explanation from score breakdown ──
    function fallbackExplanation(entry) {
      const { rank, score, breakdown = {}, request } = entry;
      const name = request.student_name ?? 'This student';
      const pct  = (breakdown.urgency  > breakdown.fairness && breakdown.urgency  > breakdown.match)
        ? 'deadline urgency'
        : breakdown.fairness > breakdown.match
        ? 'resource fairness'
        : 'project requirement match';
      return rank === 1
        ? `${name} was allocated rank 1 (score ${score}) primarily due to ${pct}.`
        : `${name} received rank ${rank} (score ${score}); a higher-priority request with stronger ${pct} was present.`;
    }

    // ── Merge AI output back onto the ORIGINAL ranked order ──
    // Server enforces ordering — AI text is mapped by index, never by any
    // ordering field the AI might have changed.
    const explanations = ranked.map((entry, i) => {
      let explanation = fallbackExplanation(entry);
      if (aiExplanations) {
        const aiEntry = aiExplanations.find(e => e.student_id_index === i);
        if (aiEntry && typeof aiEntry.explanation === 'string' && aiEntry.explanation.trim()) {
          explanation = aiEntry.explanation.trim();
        }
      }
      return {
        student_id:   entry.request.student_id,
        student_name: entry.request.student_name ?? entry.request.student_id,
        rank:         entry.rank,
        score:        entry.score,
        explanation,
      };
    });

    res.json({ explanations });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

module.exports = router;

