import { useState, useRef, useId } from 'react';
import { useApi } from '../hooks/useApi';

const MAX_CHARS = 300;

/**
 * "Ask AI" box — sends a free-text need to POST /api/ai/discover.
 * On Gemini failure the server returns fallback:true with keyword results;
 * we surface a clear notice rather than a blank state.
 *
 * Props:
 *   onResults(items) — called with the array of matching equipment items
 */
export default function AskAI({ onResults }) {
  const apiFetch      = useApi();
  const textareaId    = useId();
  const hintId        = useId();
  const textareaRef   = useRef(null);

  const [need, setNeed]         = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [fallback, setFallback] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const remaining = MAX_CHARS - need.length;
  const overLimit = remaining < 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (overLimit || !need.trim()) return;
    setError('');
    setFallback(false);
    setSubmitted(false);
    setBusy(true);

    try {
      const data = await apiFetch('/api/ai/discover', {
        method: 'POST',
        body: JSON.stringify({ need: need.trim() }),
      });
      onResults(data.results ?? []);
      setFallback(data.fallback ?? false);
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleClear() {
    setNeed('');
    setError('');
    setFallback(false);
    setSubmitted(false);
    onResults(null); // null = "clear AI filter"
    textareaRef.current?.focus();
  }

  return (
    <section className="ask-ai-box" aria-labelledby="ask-ai-heading">
      <div className="ask-ai-header">
        <span className="ask-ai-icon" aria-hidden="true">✦</span>
        <h2 id="ask-ai-heading" className="ask-ai-title">Ask AI</h2>
        <span className="ask-ai-badge">Gemini</span>
      </div>
      <p className="ask-ai-desc">
        Describe your project need in plain English and AI will suggest the best matching equipment.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={textareaId}>Describe your need</label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            rows={3}
            value={need}
            onChange={e => setNeed(e.target.value)}
            placeholder='e.g. "IoT sensor project due next Friday, need wireless connectivity and GPIO"'
            aria-describedby={hintId}
            aria-invalid={overLimit || undefined}
            disabled={busy}
          />
          <span
            id={hintId}
            className={`char-count${overLimit ? ' char-count-over' : ''}`}
            aria-live="polite"
          >
            {overLimit
              ? `${Math.abs(remaining)} characters over limit`
              : `${remaining} characters remaining`}
          </span>
        </div>

        {error && (
          <p role="alert" className="form-error" aria-live="assertive">
            {error}
          </p>
        )}

        {fallback && submitted && (
          <p role="status" className="ai-fallback-notice" aria-live="polite">
            ⚠ AI was unavailable — showing keyword matches instead.
          </p>
        )}

        <div className="ask-ai-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || overLimit || !need.trim()}
            aria-busy={busy}
          >
            {busy ? 'Searching…' : 'Find equipment'}
          </button>
          {(submitted || need) && (
            <button type="button" className="btn btn-outline" onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
