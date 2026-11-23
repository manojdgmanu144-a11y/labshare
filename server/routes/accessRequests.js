const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roles');
const { findConflicts } = require('../utils/conflicts');
const {
  requireUuid, requireString, requireDate,
  requireDatetime, requireFutureWindow,
  requireMaxLength, MAX_LENGTHS,
} = require('../utils/validate');

// GET /api/access-requests — student sees own; faculty/admin see all (optionally filtered by status)
router.get('/', authenticate, async (req, res) => {
  try {
    let query = supabase
      .from('access_requests')
      .select('*, equipment(name, category, department, location), profiles!student_id(name, department)')
      .order('created_at', { ascending: false });

    if (req.profile.role === 'student') {
      query = query.eq('student_id', req.profile.id);
    } else if (req.query.status) {
      query = query.eq('status', req.query.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

/**
 * POST /api/access-requests
 *
 * Validates all fields, then runs conflict detection against confirmed bookings
 * AND other pending requests for the same equipment.
 *
 * Response shapes:
 *   201  { request }                   — created, no conflict
 *   409  { error, conflicts: [...] }   — overlapping bookings/requests found;
 *                                        client passes these to the AI allocator
 */
router.post('/', authenticate, requireRole('student'), async (req, res) => {
  try {
    // ── Field validation ───────────────────────────────────────
    const equipment_id  = requireUuid(req.body.equipment_id,  'equipment_id');
    const project_title = requireMaxLength(
      requireString(req.body.project_title, 'project_title'),
      'project_title', MAX_LENGTHS.project_title
    );
    const purpose = requireMaxLength(
      requireString(req.body.purpose, 'purpose'),
      'purpose', MAX_LENGTHS.purpose
    );
    const deadline   = requireDate(req.body.deadline,       'deadline');
    const start_time = requireDatetime(req.body.start_time, 'start_time');
    const end_time   = requireDatetime(req.body.end_time,   'end_time');
    requireFutureWindow(start_time, end_time);

    // Deadline must not be before the requested end time
    if (deadline < end_time.slice(0, 10)) {
      return res.status(400).json({ error: 'deadline must not be before the end of the requested slot' });
    }

    // ── Conflict detection ─────────────────────────────────────
    // Fetch all confirmed bookings + pending requests for this equipment
    const [bookingsRes, pendingRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, start_time, end_time, user_id, profiles!user_id(name)')
        .eq('equipment_id', equipment_id)
        .eq('status', 'confirmed')
        .gte('end_time', new Date().toISOString()),

      supabase
        .from('access_requests')
        .select('id, start_time, end_time, student_id, project_title, profiles!student_id(name)')
        .eq('equipment_id', equipment_id)
        .eq('status', 'pending')
        .gte('end_time', new Date().toISOString()),
    ]);

    if (bookingsRes.error) throw bookingsRes.error;
    if (pendingRes.error)  throw pendingRes.error;

    const existing  = [
      ...(bookingsRes.data ?? []).map(b => ({ ...b, type: 'booking' })),
      ...(pendingRes.data  ?? []).map(r => ({ ...r, type: 'pending_request' })),
    ];

    const conflicts = findConflicts(existing, { start_time, end_time });

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'The requested time slot overlaps with existing bookings or pending requests.',
        conflicts,
      });
    }

    // ── Create the request ─────────────────────────────────────
    const { data, error } = await supabase
      .from('access_requests')
      .insert({
        student_id: req.profile.id,
        equipment_id, project_title, purpose, deadline, start_time, end_time,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ request: data });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

// PATCH /api/access-requests/:id — faculty approves or rejects
router.patch('/:id', authenticate, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const id     = requireUuid(req.params.id, 'id');
    const status = req.body.status;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be "approved" or "rejected"' });
    }
    const faculty_note = req.body.faculty_note
      ? requireMaxLength(
          requireString(req.body.faculty_note, 'faculty_note'),
          'faculty_note', MAX_LENGTHS.faculty_note
        )
      : null;

    const { data: updated, error: updateErr } = await supabase
      .from('access_requests')
      .update({ status, faculty_note })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Auto-create a booking when approved
    if (status === 'approved') {
      await supabase.from('bookings').insert({
        equipment_id: updated.equipment_id,
        user_id:      updated.student_id,
        request_id:   updated.id,
        start_time:   updated.start_time,
        end_time:     updated.end_time,
        status:       'confirmed',
      });
    }

    res.json(updated);
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

module.exports = router;

