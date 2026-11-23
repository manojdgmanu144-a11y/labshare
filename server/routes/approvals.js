/**
 * server/routes/approvals.js
 *
 * Faculty-only approval queue.  Every endpoint requires authentication
 * and requireRole('faculty', 'admin') — enforced server-side, not just on the client.
 *
 * Routes:
 *   GET    /api/approvals            — queue list (pending, with allocation summary)
 *   GET    /api/approvals/:id        — single request detail + full allocation + AI explanation
 *   PATCH  /api/approvals/:id        — approve | reject | accept-alternative
 */
const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authenticate }   = require('../middleware/auth');
const { requireRole }    = require('../middleware/roles');
const { rankRequests }   = require('../services/allocation');
const { findConflicts }  = require('../utils/conflicts');
const { getModel, withTimeout } = require('../services/gemini');
const {
  requireUuid, requireString, requireMaxLength, MAX_LENGTHS,
} = require('../utils/validate');

// ── Shared: build allocation context for a request ───────────

/**
 * assembleContext — fetches all data needed to run the allocation engine
 * for a given equipment item and time window.
 *
 * Returns { equipment, competingRequests, recentUsage, freeSlots, equivalentEquipment }
 */
async function assembleContext(equipmentId, start_time, end_time, excludeRequestId = null) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const horizon30     = new Date(Date.now() + 30 * 86400_000).toISOString();

  const [
    equipRes, competingRes, confirmedRes,
    recentBookRes, equivRes,
  ] = await Promise.all([
    // Equipment details (specs for match scoring)
    supabase.from('equipment')
      .select('id, name, category, description, specs')
      .eq('id', equipmentId).single(),

    // All pending requests for same equipment overlapping the same window
    supabase.from('access_requests')
      .select('id, student_id, project_title, purpose, deadline, start_time, end_time, profiles!student_id(name)')
      .eq('equipment_id', equipmentId)
      .eq('status', 'pending')
      .gte('end_time', new Date().toISOString()),

    // Confirmed bookings (to build freeSlots)
    supabase.from('bookings')
      .select('id, start_time, end_time')
      .eq('equipment_id', equipmentId)
      .eq('status', 'confirmed')
      .gte('end_time', new Date().toISOString())
      .lte('start_time', horizon30)
      .order('start_time'),

    // Recent usage per student (last 30 days, confirmed bookings)
    supabase.from('bookings')
      .select('user_id, start_time, end_time')
      .eq('status', 'confirmed')
      .gte('start_time', thirtyDaysAgo),

    // Equivalent equipment (same category, different unit)
    supabase.from('equipment')
      .select('id, name, category')
      .eq('category', '')   // placeholder — overridden below after equipRes
      .limit(0),            // no-op; real query built after equipRes
  ]);

  if (equipRes.error) throw equipRes.error;
  const equipment = equipRes.data;

  // Now fetch equivalents using the real category
  const { data: equivData } = await supabase.from('equipment')
    .select('id, name, category')
    .eq('category', equipment.category)
    .neq('id', equipmentId)
    .eq('status', 'available');

  // Build recentUsage Map<student_id, hours>
  const recentUsage = new Map();
  for (const b of (recentBookRes.data ?? [])) {
    const h = (new Date(b.end_time) - new Date(b.start_time)) / 3600_000;
    recentUsage.set(b.user_id, (recentUsage.get(b.user_id) ?? 0) + h);
  }

  // Build freeSlots from confirmed bookings (gaps in next 30 days)
  const confirmed = confirmedRes.data ?? [];
  const freeSlots = [];
  let cursor = new Date().getTime();
  const windowEnd = Date.now() + 30 * 86400_000;
  for (const b of confirmed) {
    const bs = new Date(b.start_time).getTime();
    if (bs > cursor + 3600_000) {   // gap ≥ 1 h
      freeSlots.push({
        start_time: new Date(cursor).toISOString(),
        end_time:   new Date(bs).toISOString(),
      });
    }
    cursor = Math.max(cursor, new Date(b.end_time).getTime());
  }
  if (windowEnd - cursor >= 3600_000) {
    freeSlots.push({
      start_time: new Date(cursor).toISOString(),
      end_time:   new Date(windowEnd).toISOString(),
    });
  }

  // Filter competing requests to those overlapping the target window
  const allPending = (competingRes.data ?? []).map(r => ({
    ...r,
    student_name: r.profiles?.name ?? r.student_id,
  }));

  const overlapping = allPending.filter(r =>
    r.id !== excludeRequestId &&
    findConflicts([{ start_time: r.start_time, end_time: r.end_time }], { start_time, end_time }).length > 0
  );

  return {
    equipment,
    competingRequests: overlapping,
    recentUsage,
    freeSlots,
    equivalentEquipment: equivData ?? [],
  };
}

// ── GET /api/approvals ───────────────────────────────────────

router.get('/', authenticate, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const statusFilter = req.query.status || 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(statusFilter)) {
      return res.status(400).json({ error: 'status must be pending | approved | rejected | all' });
    }

    let query = supabase
      .from('access_requests')
      .select(`
        id, project_title, purpose, deadline, start_time, end_time,
        status, faculty_note, created_at,
        equipment(id, name, category, department, location),
        profiles!student_id(id, name, department)
      `)
      .order('deadline', { ascending: true })
      .order('created_at', { ascending: true });

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

    const { data, error } = await query;
    if (error) throw error;

    // For pending requests, add a lightweight conflict flag
    // (full allocation is fetched on the detail view to keep the list fast)
    const enriched = await Promise.all(data.map(async (req) => {
      if (req.status !== 'pending') return { ...req, hasConflict: false, conflictCount: 0 };

      const { data: competing } = await supabase
        .from('access_requests')
        .select('id, start_time, end_time')
        .eq('equipment_id', req.equipment.id)
        .eq('status', 'pending')
        .neq('id', req.id)
        .gte('end_time', new Date().toISOString());

      const conflicts = findConflicts(competing ?? [], {
        start_time: req.start_time, end_time: req.end_time,
      });

      return { ...req, hasConflict: conflicts.length > 0, conflictCount: conflicts.length };
    }));

    res.json(enriched);
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

// ── GET /api/approvals/:id ───────────────────────────────────

router.get('/:id', authenticate, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const id = requireUuid(req.params.id, 'id');

    const { data: request, error } = await supabase
      .from('access_requests')
      .select(`
        id, student_id, project_title, purpose, deadline,
        start_time, end_time, status, faculty_note, created_at,
        equipment(id, name, category, department, location, description, specs),
        profiles!student_id(id, name, department)
      `)
      .eq('id', id)
      .single();

    if (error) return res.status(404).json({ error: 'Request not found' });

    // Build allocation context and run engine
    const ctx = await assembleContext(
      request.equipment.id, request.start_time, request.end_time, id
    );

    // Include this request itself in the competing set
    const allRequests = [
      {
        ...request,
        student_name: request.profiles?.name ?? request.student_id,
        equipment_id: request.equipment.id,
      },
      ...ctx.competingRequests,
    ];

    const allocation = rankRequests(allRequests, {
      equipment:           ctx.equipment,
      recentUsage:         ctx.recentUsage,
      freeSlots:           ctx.freeSlots,
      equivalentEquipment: ctx.equivalentEquipment,
    });

    // Fetch Gemini explanation (best-effort — fallback built into the route handler)
    let explanation = null;
    if (allocation.ranked.length > 0) {
      try {
        const model = getModel();
        const summary = allocation.ranked.map(r => ({
          rank: r.rank,
          student: r.request.student_name ?? r.request.student_id,
          project: r.request.project_title,
          deadline: r.request.deadline,
          score: r.score,
          urgency_score:  r.breakdown?.urgency  ?? 0,
          fairness_score: r.breakdown?.fairness ?? 0,
          match_score:    r.breakdown?.match    ?? 0,
        }));

        const prompt = `You are a university lab allocation system explaining scheduling decisions to faculty.

The allocation algorithm ranked these requests using: deadline urgency (50%), fairness (30%), requirement match (20%).

Ranked results:
${JSON.stringify(summary, null, 2)}

Write a SHORT (1–2 sentence) plain-language explanation per student explaining their rank.
Do NOT suggest a different ranking. Address students by name.

Return ONLY valid JSON:
{ "explanations": [ { "student_id_index": 0, "explanation": "..." }, ... ] }`;

        const result  = await withTimeout(model.generateContent(prompt));
        const text    = result.response.text().trim();
        const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed.explanations)) {
            // Map by index — server enforces the original ranked order
            explanation = allocation.ranked.map((entry, i) => {
              const aiEntry = parsed.explanations.find(e => e.student_id_index === i);
              return {
                student_id:   entry.request.student_id,
                student_name: entry.request.student_name ?? entry.request.student_id,
                rank:         entry.rank,
                score:        entry.score,
                explanation:  aiEntry?.explanation?.trim() ?? buildFallbackExplanation(entry),
              };
            });
          }
        }
      } catch (_) { /* fall through */ }

      if (!explanation) {
        explanation = allocation.ranked.map(entry => ({
          student_id:   entry.request.student_id,
          student_name: entry.request.student_name ?? entry.request.student_id,
          rank:         entry.rank,
          score:        entry.score,
          explanation:  buildFallbackExplanation(entry),
        }));
      }
    }

    res.json({
      request,
      allocation: {
        ranked:       allocation.ranked,
        alternatives: allocation.alternatives,
        feasible:     allocation.feasible,
      },
      explanation,
    });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

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

// ── PATCH /api/approvals/:id ─────────────────────────────────

router.patch('/:id', authenticate, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const id     = requireUuid(req.params.id, 'id');
    const action = req.body.action;   // 'approve' | 'reject' | 'accept_alternative'

    if (!['approve', 'reject', 'accept_alternative'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve | reject | accept_alternative' });
    }

    const faculty_note = req.body.faculty_note
      ? requireMaxLength(
          requireString(req.body.faculty_note, 'faculty_note'),
          'faculty_note', MAX_LENGTHS.faculty_note
        )
      : null;

    // Fetch the original request (verify it's still pending)
    const { data: original, error: fetchErr } = await supabase
      .from('access_requests')
      .select('id, student_id, equipment_id, start_time, end_time, status')
      .eq('id', id).single();

    if (fetchErr || !original) return res.status(404).json({ error: 'Request not found' });
    if (original.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${original.status}` });
    }

    if (action === 'reject') {
      const { data, error } = await supabase
        .from('access_requests')
        .update({ status: 'rejected', faculty_note })
        .eq('id', id).select().single();
      if (error) throw error;
      return res.json({ request: data });
    }

    // approve or accept_alternative — determine the slot to book
    let bookStart = original.start_time;
    let bookEnd   = original.end_time;

    if (action === 'accept_alternative') {
      const altStart = req.body.alternative_start;
      const altEnd   = req.body.alternative_end;
      if (!altStart || !altEnd) {
        return res.status(400).json({ error: 'alternative_start and alternative_end are required for accept_alternative' });
      }
      const s = Date.parse(altStart);
      const e = Date.parse(altEnd);
      if (isNaN(s) || isNaN(e) || s >= e) {
        return res.status(400).json({ error: 'alternative times are invalid' });
      }
      bookStart = new Date(s).toISOString();
      bookEnd   = new Date(e).toISOString();
    }

    // Final overlap check before confirming
    const { data: existing } = await supabase
      .from('bookings')
      .select('id, start_time, end_time')
      .eq('equipment_id', original.equipment_id)
      .eq('status', 'confirmed')
      .gte('end_time', new Date().toISOString());

    const conflicts = findConflicts(existing ?? [], { start_time: bookStart, end_time: bookEnd });
    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'The chosen slot now conflicts with a confirmed booking.',
        conflicts,
      });
    }

    // Update request to approved
    const { data: approved, error: updateErr } = await supabase
      .from('access_requests')
      .update({
        status:     'approved',
        faculty_note,
        start_time: bookStart,
        end_time:   bookEnd,
      })
      .eq('id', id).select().single();
    if (updateErr) throw updateErr;

    // Create the booking
    const { error: bookErr } = await supabase.from('bookings').insert({
      equipment_id: original.equipment_id,
      user_id:      original.student_id,
      request_id:   id,
      start_time:   bookStart,
      end_time:     bookEnd,
      status:       'confirmed',
    });
    if (bookErr) throw bookErr;

    res.json({ request: approved });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

module.exports = router;

