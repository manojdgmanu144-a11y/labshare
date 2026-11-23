const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/activity
 * Returns the 20 most recent events across bookings + access_requests
 * for the authenticated user (students see their own; faculty/admin see all).
 *
 * Each event has: { id, type, title, detail, status, occurred_at, equipment_name }
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { id: userId, role } = req.profile;
    const isStudent = role === 'student';
    const limit = 20;

    const [bookRes, reqRes] = await Promise.all([
      // Recent bookings
      (() => {
        let q = supabase
          .from('bookings')
          .select('id, status, start_time, end_time, created_at, equipment(name)')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (isStudent) q = q.eq('user_id', userId);
        return q;
      })(),

      // Recent access requests (include student name for faculty view)
      (() => {
        let q = supabase
          .from('access_requests')
          .select(`
            id, status, project_title, deadline, created_at,
            equipment(name),
            profiles!student_id(name)
          `)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (isStudent) q = q.eq('student_id', userId);
        return q;
      })(),
    ]);

    if (bookRes.error)  throw bookRes.error;
    if (reqRes.error)   throw reqRes.error;

    // Shape into uniform activity events
    const bookEvents = (bookRes.data ?? []).map(b => ({
      id:             `booking-${b.id}`,
      type:           'booking',
      title:          b.equipment?.name ?? 'Equipment',
      detail:         `Booking ${b.status}`,
      status:         b.status,
      occurred_at:    b.created_at,
      equipment_name: b.equipment?.name ?? null,
    }));

    const reqEvents = (reqRes.data ?? []).map(r => ({
      id:             `request-${r.id}`,
      type:           'request',
      title:          r.project_title,
      detail:         isStudent
        ? `Request ${r.status}`
        : `${r.profiles?.name ?? 'Student'} — ${r.status}`,
      status:         r.status,
      occurred_at:    r.created_at,
      equipment_name: r.equipment?.name ?? null,
      student_name:   r.profiles?.name ?? null,
    }));

    // Merge and sort by occurred_at descending, take top 20
    const all = [...bookEvents, ...reqEvents]
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .slice(0, limit);

    res.json(all);
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

module.exports = router;

