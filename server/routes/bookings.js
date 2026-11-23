const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authenticate }        = require('../middleware/auth');
const { requireRole }         = require('../middleware/roles');
const { requireUuid, requireDatetime, requireFutureWindow } = require('../utils/validate');

// GET /api/bookings — user's own bookings
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, equipment(name, location, department)')
      .eq('user_id', req.profile.id)
      .order('start_time');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

/**
 * GET /api/bookings/equipment/:equipmentId
 * Returns confirmed bookings + pending requests for a given equipment item,
 * limited to those ending in the future (default) or within an optional
 * ?days=N window (max 90).
 *
 * Response shape:
 *   { bookings: [...], pendingRequests: [...] }
 *
 * Both arrays contain { start_time, end_time } so the client can render a
 * combined "busy" calendar without needing separate calls.
 */
router.get('/equipment/:equipmentId', authenticate, async (req, res) => {
  try {
    const equipmentId = requireUuid(req.params.equipmentId, 'equipmentId');

    const rawDays = req.query.days !== undefined ? Number(req.query.days) : 30;
    const days    = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 90 ? rawDays : 30;

    const now     = new Date().toISOString();
    const horizon = new Date(Date.now() + days * 86400_000).toISOString();

    const [bookingsRes, pendingRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, start_time, end_time')
        .eq('equipment_id', equipmentId)
        .eq('status', 'confirmed')
        .gte('end_time', now)
        .lte('start_time', horizon)
        .order('start_time'),

      supabase
        .from('access_requests')
        .select('id, start_time, end_time, project_title')
        .eq('equipment_id', equipmentId)
        .eq('status', 'pending')
        .gte('end_time', now)
        .lte('start_time', horizon)
        .order('start_time'),
    ]);

    if (bookingsRes.error) throw bookingsRes.error;
    if (pendingRes.error)  throw pendingRes.error;

    res.json({
      bookings:        bookingsRes.data ?? [],
      pendingRequests: pendingRes.data  ?? [],
    });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

// POST /api/bookings — create a direct booking (faculty/admin only — bypasses approval flow)
router.post('/', authenticate, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const equipment_id = requireUuid(req.body.equipment_id, 'equipment_id');
    const start_time   = requireDatetime(req.body.start_time, 'start_time');
    const end_time     = requireDatetime(req.body.end_time,   'end_time');
    requireFutureWindow(start_time, end_time);

    const { data, error } = await supabase.from('bookings').insert({
      equipment_id,
      user_id:    req.profile.id,
      start_time,
      end_time,
      status: 'confirmed',
    }).select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

// DELETE /api/bookings/:id — cancel own booking
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const id = requireUuid(req.params.id, 'id');
    const { data: existing, error: fetchErr } = await supabase
      .from('bookings').select('id, user_id').eq('id', id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Booking not found' });
    if (existing.user_id !== req.profile.id) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
    res.json({ message: 'Booking cancelled' });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

module.exports = router;

