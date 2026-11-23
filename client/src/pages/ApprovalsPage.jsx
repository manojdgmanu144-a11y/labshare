import { useState, useEffect, useCallback, useId } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { fmtSlot } from '../utils/timeSlots';

// ── Shared helpers ────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysUntil(d) {
  return Math.ceil((new Date(d) - new Date()) / 86400_000);
}

function ScoreMeter({ value, label }) {
  const pct = Math.round(value * 100);
  return (
    <div className="score-meter">
      <div className="score-meter-bar">
        <div
          className="score-meter-fill"
          style={{ width: `${pct}%` }}
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${pct}%`}
        />
      </div>
      <span className="score-meter-label">{label} {pct}%</span>
    </div>
  );
}

// ── Allocation detail panel ───────────────────────────────────

function AllocationPanel({ allocation, explanation }) {
  if (!allocation?.ranked?.length) return null;

  return (
    <div className="allocation-panel">
      <h3 className="alloc-title">Allocation ranking</h3>
      <p className="alloc-desc">
        Scored on deadline urgency (50%), fairness (30%), requirement match (20%).
      </p>

      <ol className="alloc-list" aria-label="Ranked requests">
        {allocation.ranked.map(entry => {
          const expl = explanation?.find(e => e.student_id === entry.request.student_id);
          const days = daysUntil(entry.request.deadline);
          return (
            <li
              key={entry.request.id}
              className={`alloc-entry${entry.rank === 1 ? ' alloc-top' : ''}`}
              aria-label={`Rank ${entry.rank}: ${entry.request.student_name ?? entry.request.student_id}`}
            >
              <div className="alloc-entry-header">
                <span className="alloc-rank">#{entry.rank}</span>
                <div className="alloc-student">
                  <span className="alloc-name">{entry.request.student_name ?? entry.request.student_id}</span>
                  <span className="alloc-project">"{entry.request.project_title}"</span>
                </div>
                <span className={`alloc-score-badge${entry.rank === 1 ? ' alloc-score-top' : ''}`}>
                  {Math.round(entry.score * 100)}
                </span>
              </div>

              <div className="alloc-meters">
                <ScoreMeter value={entry.breakdown.urgency}  label="Urgency"  />
                <ScoreMeter value={entry.breakdown.fairness} label="Fairness" />
                <ScoreMeter value={entry.breakdown.match}    label="Match"    />
              </div>

              <div className="alloc-meta">
                <span>Deadline: <strong className={days <= 2 ? 'text-urgent' : ''}>{entry.request.deadline}</strong></span>
                <span>Slot: {fmt(entry.request.start_time)} → {fmt(entry.request.end_time)}</span>
              </div>

              {expl && (
                <p className="alloc-explanation">
                  <span aria-hidden="true">✦ </span>{expl.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {!allocation.feasible && (
        <p className="alloc-infeasible" role="status">
          ⚠ All deadlines for competing requests have passed — slots may be infeasible.
        </p>
      )}
    </div>
  );
}

// ── Action form ───────────────────────────────────────────────

function ActionForm({ requestId, alternatives, onDone }) {
  const apiFetch = useApi();
  const noteId   = useId();
  const altStartId = useId();
  const altEndId   = useId();

  const [action,   setAction]   = useState('approve');
  const [note,     setNote]     = useState('');
  const [altStart, setAltStart] = useState('');
  const [altEnd,   setAltEnd]   = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  // Pre-fill alternative slot from first free slot suggestion
  const firstFreeSlot = alternatives ? Object.values(alternatives)[0]?.freeSlots?.[0] : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (action === 'accept_alternative' && (!altStart || !altEnd)) {
      setErr('Provide both start and end times for the alternative slot.');
      return;
    }
    setBusy(true);
    try {
      const body = { action, faculty_note: note || undefined };
      if (action === 'accept_alternative') {
        body.alternative_start = new Date(altStart).toISOString();
        body.alternative_end   = new Date(altEnd).toISOString();
      }
      await apiFetch(`/api/approvals/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onDone(action);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function localIso(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return (
    <form className="action-form" onSubmit={handleSubmit} aria-label="Approval decision">
      <h3 className="action-form-title">Decision</h3>

      {err && <p role="alert" className="form-error">{err}</p>}

      {/* Action selector */}
      <fieldset className="action-radio-group">
        <legend className="sr-only">Choose action</legend>
        {[
          { value: 'approve',            label: 'Approve original slot' },
          { value: 'reject',             label: 'Reject request' },
          { value: 'accept_alternative', label: 'Approve with alternative slot' },
        ].map(opt => (
          <label key={opt.value} className={`action-radio${action === opt.value ? ' selected' : ''}`}>
            <input
              type="radio"
              name="action"
              value={opt.value}
              checked={action === opt.value}
              onChange={() => setAction(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      {/* Alternative slot inputs */}
      {action === 'accept_alternative' && (
        <div className="alt-slot-fields">
          <p className="alt-slot-hint">
            {firstFreeSlot
              ? `Suggested free slot: ${fmtSlot(new Date(firstFreeSlot.start_time), new Date(firstFreeSlot.end_time))}`
              : 'Enter a conflict-free time below.'}
          </p>
          <div className="time-row">
            <div className="field">
              <label htmlFor={altStartId}>Alternative start</label>
              <input
                id={altStartId}
                type="datetime-local"
                value={altStart || (firstFreeSlot ? localIso(firstFreeSlot.start_time) : '')}
                onChange={e => setAltStart(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={altEndId}>Alternative end</label>
              <input
                id={altEndId}
                type="datetime-local"
                value={altEnd || (firstFreeSlot ? localIso(firstFreeSlot.end_time) : '')}
                onChange={e => setAltEnd(e.target.value)}
                required
              />
            </div>
          </div>
        </div>
      )}

      {/* Note */}
      <div className="field">
        <label htmlFor={noteId}>
          Note to student <span className="field-optional">(optional)</span>
        </label>
        <textarea
          id={noteId}
          rows={3}
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={400}
          placeholder="Reason for decision, suggested alternatives…"
        />
      </div>

      <button
        type="submit"
        className={`btn btn-block${action === 'reject' ? ' btn-danger' : ' btn-primary'}`}
        disabled={busy}
        aria-busy={busy}
      >
        {busy
          ? 'Saving…'
          : action === 'approve' ? 'Approve request'
          : action === 'reject'  ? 'Reject request'
          : 'Approve with alternative slot'}
      </button>
    </form>
  );
}

// ── Detail drawer ─────────────────────────────────────────────

function RequestDetail({ requestId, onClose, onDone }) {
  const apiFetch = useApi();
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
    if (!requestId) return;
    setLoading(true);
    setErr('');
    apiFetch(`/api/approvals/${requestId}`)
      .then(d => setDetail(d))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [requestId, apiFetch]);

  function handleDone(action) {
    setResolved(action);
    onDone?.();
  }

  const req = detail?.request;

  return (
    <aside
      className="detail-drawer"
      aria-label="Request detail"
      role="complementary"
    >
      <div className="drawer-header">
        <h2 className="drawer-title">Request detail</h2>
        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      {loading && <p className="loading-msg" aria-live="polite" aria-busy="true">Loading…</p>}
      {err     && <p role="alert" className="form-error">{err}</p>}

      {resolved && (
        <div className="resolved-banner" role="status" aria-live="polite">
          ✓ {resolved === 'approve' ? 'Approved' : resolved === 'reject' ? 'Rejected' : 'Approved with alternative'} successfully.
        </div>
      )}

      {req && !resolved && (
        <>
          {/* Request summary */}
          <section className="drawer-section">
            <h3 className="drawer-section-title">Project</h3>
            <dl className="detail-dl">
              <dt>Title</dt>       <dd>{req.project_title}</dd>
              <dt>Student</dt>     <dd>{req.profiles?.name}</dd>
              <dt>Department</dt>  <dd>{req.profiles?.department}</dd>
              <dt>Equipment</dt>   <dd>{req.equipment?.name}</dd>
              <dt>Location</dt>    <dd>{req.equipment?.location}</dd>
              <dt>Requested slot</dt>
              <dd>{fmt(req.start_time)} → {fmt(req.end_time)}</dd>
              <dt>Deadline</dt>    <dd>{req.deadline}</dd>
            </dl>
            <div className="drawer-purpose">
              <strong>Purpose:</strong>
              <p>{req.purpose}</p>
            </div>
          </section>

          {/* Allocation ranking + AI explanation */}
          <section className="drawer-section">
            <AllocationPanel
              allocation={detail.allocation}
              explanation={detail.explanation}
            />
          </section>

          {/* Action form — only shown if request is still pending */}
          {req.status === 'pending' && (
            <section className="drawer-section">
              <ActionForm
                requestId={req.id}
                alternatives={detail.allocation?.alternatives}
                onDone={handleDone}
              />
            </section>
          )}

          {/* Already-decided state */}
          {req.status !== 'pending' && (
            <div className={`status-resolved status-${req.status}`}>
              <strong>{req.status === 'approved' ? '✓ Approved' : '✕ Rejected'}</strong>
              {req.faculty_note && <p className="faculty-note">"{req.faculty_note}"</p>}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

// ── Main ApprovalsPage ────────────────────────────────────────

export default function ApprovalsPage() {
  const apiFetch      = useApi();
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests,  setRequests]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState('');
  const [filter,    setFilter]    = useState('pending');
  const [activeId,  setActiveId]  = useState(searchParams.get('id') ?? null);

  const filterId = useId();

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await apiFetch(`/api/approvals?status=${filter}`);
      setRequests(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  function openDetail(id) {
    setActiveId(id);
    setSearchParams(id ? { id } : {}, { replace: true });
  }

  function handleDone() {
    fetchQueue();      // refresh queue after action
  }

  return (
    <main id="main-content" className={`page-container${activeId ? ' with-drawer' : ''}`}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Approval Queue</h1>
          <p className="page-subtitle">{requests.length} request{requests.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/dashboard" className="btn btn-outline">← Dashboard</Link>
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs" role="tablist" aria-label="Filter by status">
        {['pending', 'approved', 'rejected', 'all'].map(s => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={filter === s}
            className={`filter-tab${filter === s ? ' active' : ''}`}
            onClick={() => { setFilter(s); setActiveId(null); }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {err && <p role="alert" className="form-error">{err}</p>}

      <div className="approvals-layout">
        {/* Queue list */}
        <div className="approvals-list" aria-live="polite" aria-busy={loading}>
          {loading
            ? <p className="loading-msg">Loading…</p>
            : requests.length === 0
            ? (
              <div className="eq-empty">
                <p className="eq-empty-title">No {filter !== 'all' ? filter : ''} requests</p>
              </div>
            )
            : (
              <ul role="list" className="queue-list">
                {requests.map(r => {
                  const days    = daysUntil(r.deadline);
                  const urgent  = days <= 2;
                  const isOpen  = activeId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`queue-item${isOpen ? ' queue-item-open' : ''}${r.hasConflict ? ' queue-item-conflict' : ''}`}
                        onClick={() => openDetail(isOpen ? null : r.id)}
                        aria-expanded={isOpen}
                        aria-pressed={isOpen}
                      >
                        <div className="queue-item-top">
                          <div className="queue-item-info">
                            <span className="queue-student">{r.profiles?.name ?? '—'}</span>
                            <span className="queue-project">{r.project_title}</span>
                            <span className="queue-equip">{r.equipment?.name}</span>
                          </div>
                          <div className="queue-item-meta">
                            {r.hasConflict && (
                              <span className="conflict-pill" aria-label="Has scheduling conflict">
                                ⚠ Conflict
                              </span>
                            )}
                            <span className={`badge ${
                              r.status === 'approved' ? 'badge-green'
                              : r.status === 'rejected' ? 'badge-red'
                              : urgent ? 'badge-amber' : 'badge-gray'
                            }`}>
                              {r.status === 'pending'
                                ? (days < 0 ? 'Overdue' : days === 0 ? 'Due today' : `${days}d`)
                                : r.status}
                            </span>
                          </div>
                        </div>
                        <div className="queue-item-slot">
                          {fmt(r.start_time)} → {fmt(r.end_time)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </div>

        {/* Detail drawer */}
        {activeId && (
          <RequestDetail
            requestId={activeId}
            onClose={() => openDetail(null)}
            onDone={handleDone}
          />
        )}
      </div>
    </main>
  );
}
