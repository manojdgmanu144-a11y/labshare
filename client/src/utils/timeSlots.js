/**
 * buildFreeSlots — client-side utility.
 *
 * Given a list of busy intervals and a time range [windowStart, windowEnd],
 * returns gaps (free slots) of at least `minDurationMs` milliseconds.
 *
 * Intervals may come from both bookings and pending requests (treat both as busy).
 *
 * @param {Array<{start_time:string, end_time:string}>} busyIntervals
 * @param {Date|string} windowStart  — earliest slot start
 * @param {Date|string} windowEnd    — latest slot end
 * @param {number}      minDurationMs — minimum free gap to include (default 1 h)
 * @returns {Array<{start: Date, end: Date, durationMs: number}>}
 */
export function buildFreeSlots(busyIntervals, windowStart, windowEnd, minDurationMs = 3600_000) {
  const start = new Date(windowStart).getTime();
  const end   = new Date(windowEnd).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) return [];

  // Sort busy intervals by start
  const busy = busyIntervals
    .map(b => ({ s: new Date(b.start_time).getTime(), e: new Date(b.end_time).getTime() }))
    .filter(b => !isNaN(b.s) && !isNaN(b.e) && b.s < b.e)
    .sort((a, b) => a.s - b.s);

  const free = [];
  let cursor = start;

  for (const interval of busy) {
    if (interval.s > cursor) {
      // Gap before this busy interval
      const slotStart = cursor;
      const slotEnd   = Math.min(interval.s, end);
      if (slotEnd - slotStart >= minDurationMs) {
        free.push({ start: new Date(slotStart), end: new Date(slotEnd), durationMs: slotEnd - slotStart });
      }
    }
    // Advance cursor past this busy interval (merge overlaps)
    cursor = Math.max(cursor, interval.e);
    if (cursor >= end) break;
  }

  // Trailing free gap after last busy interval
  if (cursor < end && end - cursor >= minDurationMs) {
    free.push({ start: new Date(cursor), end: new Date(end), durationMs: end - cursor });
  }

  return free;
}

/**
 * fmtSlot — format a slot for display, e.g. "Mon 24 Nov, 09:00 – 11:00"
 */
export function fmtSlot(start, end) {
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  const timeOpts = { hour: '2-digit', minute: '2-digit' };
  const datePart = start.toLocaleDateString(undefined, opts);
  const s = start.toLocaleTimeString(undefined, timeOpts);
  const e = new Date(end).toLocaleTimeString(undefined, timeOpts);
  return `${datePart}, ${s} – ${e}`;
}

/**
 * fmtDuration — human-readable duration, e.g. "2h 30m"
 */
export function fmtDuration(ms) {
  const h = Math.floor(ms / 3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
