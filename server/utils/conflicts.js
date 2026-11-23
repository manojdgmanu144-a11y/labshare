/**
 * findConflicts — pure overlap-detection function.
 *
 * Uses the half-open interval model [start, end) which matches the DB trigger.
 * Two intervals [a,b) and [c,d) overlap iff a < d && c < b.
 *
 * @param {Array<{start_time: string, end_time: string, [key: string]: any}>} existing
 *   Confirmed bookings (or pending requests) already in the system.
 * @param {{ start_time: string, end_time: string }} requested
 *   The proposed new booking window.
 * @returns {Array} Subset of `existing` whose windows overlap with `requested`.
 *
 * Returns an empty array when there is no conflict (safe to proceed).
 */
function findConflicts(existing, requested) {
  const reqStart = Date.parse(requested.start_time);
  const reqEnd   = Date.parse(requested.end_time);

  if (isNaN(reqStart) || isNaN(reqEnd) || reqStart >= reqEnd) return [];

  return existing.filter(slot => {
    const s = Date.parse(slot.start_time);
    const e = Date.parse(slot.end_time);
    if (isNaN(s) || isNaN(e)) return false;
    // Half-open overlap: [s,e) ∩ [reqStart,reqEnd) ≠ ∅  ⟺  s < reqEnd && reqStart < e
    return s < reqEnd && reqStart < e;
  });
}

module.exports = { findConflicts };
