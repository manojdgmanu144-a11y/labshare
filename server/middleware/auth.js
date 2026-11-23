const supabase = require('../services/supabase');

/**
 * Verifies the Bearer JWT, then loads the user's profile (name, role,
 * department) in a single query and attaches both to the request.
 *
 * After this middleware:
 *   req.user        — Supabase auth user object
 *   req.profile     — { id, name, role, department }
 *   req.token       — the raw JWT (passed to downstream calls if needed)
 */
async function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Load role + profile in one query so requireRole() pays no extra DB cost.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, name, role, department')
    .eq('id', data.user.id)
    .single();

  if (profileErr || !profile) {
    return res.status(403).json({ error: 'User profile not found. Complete registration first.' });
  }

  req.user    = data.user;
  req.profile = profile;
  req.token   = token;
  next();
}

module.exports = { authenticate };
