const supabase = require('../services/supabase');

/**
 * Factory — returns middleware that allows only the given roles.
 * Because authenticate() already loaded req.profile, this is a zero-DB check.
 *
 * Usage:  router.patch('/approve', authenticate, requireRole('faculty', 'admin'), handler)
 */
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.profile) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.profile.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireRole };
