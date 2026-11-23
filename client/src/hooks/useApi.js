import { useAuth } from '../context/AuthContext';
import { useCallback } from 'react';

/**
 * Returns a stable `apiFetch(path, options)` function pre-loaded with the
 * user's auth token.  Throws an Error (with `.status`) on non-2xx responses.
 *
 * Usage:
 *   const apiFetch = useApi();
 *   const data = await apiFetch('/api/equipment?status=available');
 */
export function useApi() {
  const { getToken } = useAuth();

  return useCallback(async (path, options = {}) => {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const res = await fetch(path, { ...options, headers });

    if (!res.ok) {
      let message = `Request failed: ${res.status}`;
      let body = null;
      try {
        body = await res.json();
        if (body?.error) message = body.error;
      } catch (_) { /* ignore parse error */ }
      const err = new Error(message);
      err.status = res.status;
      err.body   = body;   // callers can inspect the full payload (e.g. conflicts array)
      throw err;
    }

    return res.json();
  }, [getToken]);
}
