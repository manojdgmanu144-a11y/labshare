const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authenticate } = require('../middleware/auth');
const { requireUuid, sanitiseError } = require('../utils/validate');

/** Allowed values for validated enum query params */
const VALID_STATUSES    = new Set(['available', 'in_use', 'maintenance', 'retired']);
const VALID_CATEGORIES  = new Set([
  'Development Kit', 'Test & Measurement', 'FPGA', 'Workstation',
  '3D Printer', 'Training System', 'Medical Simulation', 'Medical Imaging',
  'Optics', 'Vacuum Systems', 'Measurement',
]);

/**
 * GET /api/equipment
 * Query params (all optional, all validated):
 *   status      — one of VALID_STATUSES
 *   department  — freetext, max 80 chars
 *   category    — one of VALID_CATEGORIES
 *   search      — freetext keyword, max 120 chars (applied to name + description)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, department, category, search } = req.query;

    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }
    if (department && (typeof department !== 'string' || department.length > 80)) {
      return res.status(400).json({ error: 'department must be a string of at most 80 characters' });
    }
    if (category && !VALID_CATEGORIES.has(category)) {
      return res.status(400).json({ error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}` });
    }
    if (search && (typeof search !== 'string' || search.length > 120)) {
      return res.status(400).json({ error: 'search must be a string of at most 120 characters' });
    }

    let query = supabase
      .from('equipment')
      .select('id, name, category, department, location, description, specs, status');

    if (status)     query = query.eq('status', status);
    if (department) query = query.eq('department', department);
    if (category)   query = query.eq('category', category);

    // Full-text keyword search across name + description using Postgres ilike
    if (search) {
      const term = search.replace(/[%_\\]/g, '\\$&'); // escape LIKE metacharacters
      query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error } = await query.order('name');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    const { status, message } = sanitiseError(err); res.status(status).json({ error: message });
  }
});

// GET /api/equipment/meta — available filter options (departments + categories)
router.get('/meta', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('equipment')
      .select('department, category');
    if (error) throw error;

    const departments = [...new Set(data.map(r => r.department))].sort();
    const categories  = [...new Set(data.map(r => r.category))].sort();
    res.json({ departments, categories });
  } catch (err) {
    const { status, message } = sanitiseError(err); res.status(status).json({ error: message });
  }
});

// GET /api/equipment/:id — single item with full specs
router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = requireUuid(req.params.id, 'id');
    const { data, error } = await supabase
      .from('equipment').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Equipment not found' });
    res.json(data);
  } catch (err) {
    const { status, message } = sanitiseError(err); res.status(status).json({ error: message });
  }
});

module.exports = router;
