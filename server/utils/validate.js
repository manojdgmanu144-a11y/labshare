/**
 * Lightweight input validation helpers.
 * No external library — keeps dependencies lean.
 */

/** Field max-length constants (centralised so server and tests share them) */
const MAX_LENGTHS = {
  project_title: 120,
  purpose:       600,
  faculty_note:  400,
};

/**
 * Sanitise an error for the HTTP response.
 * Validation errors (status 400–499) always expose their message.
 * Server errors (500+) expose the message only outside production,
 * preventing internal DB / stack details from leaking to clients.
 *
 * @param {Error & { status?: number }} err
 * @returns {{ status: number, message: string }}
 */
function sanitiseError(err) {
  const status = err.status || err.statusCode || 500;
  const isClientError = status >= 400 && status < 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message = isClientError || !isProd
    ? err.message
    : 'An internal error occurred.';
  return { status, message };
}

/**
 * Assert that value is a non-empty string.
 * @param {unknown} value
 * @param {string}  field  - field name for error messages
 */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Object.assign(new Error(`${field} is required and must be a non-empty string`), { status: 400 });
  }
  return value.trim();
}

/**
 * Assert that value is a valid ISO date-time string that can be parsed.
 */
function requireDatetime(value, field) {
  const ms = Date.parse(value);
  if (!value || isNaN(ms)) {
    throw Object.assign(new Error(`${field} must be a valid ISO date-time string`), { status: 400 });
  }
  return new Date(ms).toISOString();
}

/**
 * Assert that value is a valid YYYY-MM-DD date string.
 */
function requireDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw Object.assign(new Error(`${field} must be a valid YYYY-MM-DD date`), { status: 400 });
  }
  return value;
}

/**
 * Assert that a time window is valid (start < end, start is in the future).
 */
function requireFutureWindow(start, end) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (s >= e) {
    throw Object.assign(new Error('end_time must be after start_time'), { status: 400 });
  }
  if (s < Date.now() - 60_000) { // 1 min grace for clock skew
    throw Object.assign(new Error('start_time must be in the future'), { status: 400 });
  }
}

/**
 * Assert that value is a valid UUID v4.
 */
function requireUuid(value, field) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value || !UUID_RE.test(value)) {
    throw Object.assign(new Error(`${field} must be a valid UUID`), { status: 400 });
  }
  return value;
}

/**
 * Assert that a string does not exceed maxLen characters (after trimming).
 * Call after requireString so the value is already trimmed.
 */
function requireMaxLength(value, field, maxLen) {
  if (typeof value === 'string' && value.length > maxLen) {
    throw Object.assign(
      new Error(`${field} must be ${maxLen} characters or fewer (got ${value.length})`),
      { status: 400 }
    );
  }
  return value;
}

module.exports = {
  requireString, requireDatetime, requireDate,
  requireFutureWindow, requireUuid, requireMaxLength,
  MAX_LENGTHS, sanitiseError,
};
