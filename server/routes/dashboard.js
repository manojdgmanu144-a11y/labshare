const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/dashboard
 * Returns role-aware KPI counts in a single response.
 *
 * Student response:
 *   { activeBookings, pendingRequests, upcomingDeadlines, nextBooking }
 *
 * Faculty / admin response:
 *   { pendingApprovals, approvedToday, totalActiveBookings, upcomingDeadlines }
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.profile.id;
    const role   = req.profile.role;
    const now    = new Date().toISOString();

    if (role === 'student') {
      const [bookingsRes, requestsRes, deadlinesRes, myRequestsRes] = await Promise.all([
        // Active (confirmed) bookings that haven't ended yet
        supabase
          .from('bookings')
          .select('id, start_time, end_time, equipment(name, location)', { count: 'exact' })
          .eq('user_id', userId)
          .eq('status', 'confirmed')
          .gte('end_time', now)
          .order('start_time')
          .limit(1),

        // Pending access requests
        supabase
          .from('access_requests')
          .select('id', { count: 'exact' })
          .eq('student_id', userId)
          .eq('status', 'pending'),

        // Requests with deadlines in the next 7 days
        supabase
          .from('access_requests')
          .select('id, project_title, deadline, equipment(name)')
          .eq('student_id', userId)
          .neq('status', 'rejected')
          .gte('deadline', new Date().toISOString().slice(0, 10))
          .lte('deadline', new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10))
          .order('deadline'),

        // All student's requests (for status feed) — most recent 10
        supabase
          .from('access_requests')
          .select('id, project_title, status, faculty_note, created_at, equipment(name)')
          .eq('student_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      return res.json({
        activeBookings:    bookingsRes.count  ?? 0,
        pendingRequests:   requestsRes.count  ?? 0,
        upcomingDeadlines: deadlinesRes.data  ?? [],
        nextBooking:       bookingsRes.data?.[0] ?? null,
        myRequests:        myRequestsRes.data ?? [],
      });
    }

    // faculty / admin
    const [pendingRes, approvedTodayRes, activeTotalRes, deadlinesRes] = await Promise.all([
      supabase
        .from('access_requests')
        .select('id, project_title, deadline, equipment(name), profiles!student_id(name)', { count: 'exact' })
        .eq('status', 'pending')
        .order('deadline'),

      supabase
        .from('access_requests')
        .select('id', { count: 'exact' })
        .eq('status', 'approved')
        .gte('created_at', new Date().toISOString().slice(0, 10)),

      supabase
        .from('bookings')
        .select('id', { count: 'exact' })
        .eq('status', 'confirmed')
        .gte('end_time', now),

      // All pending requests whose deadlines fall within 7 days
      supabase
        .from('access_requests')
        .select('id, project_title, deadline, equipment(name), profiles!student_id(name)')
        .eq('status', 'pending')
        .gte('deadline', new Date().toISOString().slice(0, 10))
        .lte('deadline', new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10))
        .order('deadline'),
    ]);

    // Recent activity for faculty (last 10 events)
    const { data: recentActivity } = await supabase
      .from('access_requests')
      .select('id, project_title, status, created_at, equipment(name), profiles!student_id(name)')
      .in('status', ['approved', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(10);

    return res.json({
      pendingApprovals:    pendingRes.count       ?? 0,
      approvedToday:       approvedTodayRes.count ?? 0,
      totalActiveBookings: activeTotalRes.count   ?? 0,
      upcomingDeadlines:   deadlinesRes.data      ?? [],
      pendingList:         pendingRes.data        ?? [],
      recentActivity:      recentActivity         ?? [],
    });
  } catch (err) {
    const { status: _s, message: _m } = sanitiseError(err); res.status(_s).json({ error: _m });
  }
});

module.exports = router;

