import { useState, useEffect, useId } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { buildFreeSlots, fmtSlot, fmtDuration } from '../utils/timeSlots';

const MAX_PROJECT_TITLE = 120;
const MAX_PURPOSE       = 600;

/* ── Helpers ────────────────────────────────────────────────── */
function localIso(date) {
  // Returns a datetime-local string (YYYY-MM-DDTHH:MM) for <input type=datetime-local>
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(localStr) {
  // Convert datetime-local string to full ISO string
  return localStr ? new Date(localStr).toISOString() : '';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ── AvailabilityCalendar ─────────────────────────────────────── */
function AvailabilityCalendar({ availability, onSelectSlot, selectedStart, selectedEnd }) {
  if (!availability) return null;

  const { bookings = [], pendingRequests = [] } = availability;
  const busyAll = [
    ...bookings.map(b => ({ ...b, busyType: 'confirmed' })),
    ...pendingRequests.map(r => ({ ...r, busyType: 'pending' })),
  ];

  const windowStart = new Date();
  const windowEnd   = new Date(Date.now() + 30 * 86400_000);
  const freeSlots   = buildFreeSlots(busyAll, windowStart, windowEnd, 3600_000);

  if (busyAll.length === 0 && freeSlots.length === 0) {
    return <p className="avail-empty">No bookings in the next 30 days — all slots free.</p>;
  }

  return (
    <div className="avail-panel" aria-label="Equipment availability">
      {/* Busy intervals */}
      {busyAll.length > 0 && (
        <div className="avail-section">
          <h3 className="avail-section-title">Busy slots</h3>
          <ul className="slot-list" role="list">
            {busyAll.map((b, i) => (
              <li key={i} className={`slot-item slot-busy slot-${b.busyType}`}>
                <span className="slot-label">
                  {b.busyType === 'confirmed' ? '🔴 Booked' : '🟡 Pending'}
                </span>
                <span className="slot-time">{fmtSlot(new Date(b.start_time), new Date(b.end_time))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Free slots as clickable suggestions */}
      {freeSlots.length > 0 && (
        <div className="avail-section">
          <h3 className="avail-section-title">Available slots (click to use)</h3>
          <ul className="slot-list" role="list">
            {freeSlots.slice(0, 10).map((slot, i) => {
              const isSelected =
                selectedStart && selectedEnd &&
                new Date(selectedStart).getTime() === slot.start.getTime() &&
                new Date(selectedEnd).getTime()   === slot.end.getTime();
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`slot-item slot-free${isSelected ? ' slot-selected' : ''}`}
                    onClick={() => onSelectSlot(slot.start, slot.end)}
                    aria-pressed={isSelected}
                  >
                    <span className="slot-label">🟢 Free · {fmtDuration(slot.durationMs)}</span>
                    <span className="slot-time">{fmtSlot(slot.start, slot.end)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── ConflictPanel ───────────────────────────────────────────── */
function ConflictPanel({ conflicts, onRecommend, recommending }) {
  return (
    <div className="conflict-panel" role="alert" aria-live="assertive">
      <h3 className="conflict-title">⚠ Scheduling conflict detected</h3>
      <p className="conflict-desc">
        Your requested slot overlaps with {conflicts.length} existing{' '}
        {conflicts.length === 1 ? 'entry' : 'entries'}:
      </p>
      <ul className="conflict-list" role="list">
        {conflicts.map((c, i) => (
          <li key={i} className="conflict-item">
            <span className={`conflict-badge ${c.type === 'booking' ? 'badge-red' : 'badge-amber'}`}>
              {c.type === 'booking' ? 'Confirmed' : 'Pending'}
            </span>
            <span className="conflict-time">{fmtSlot(new Date(c.start_time), new Date(c.end_time))}</span>
            {c.project_title && <span className="conflict-project">"{c.project_title}"</span>}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-outline"
        onClick={onRecommend}
        disabled={recommending}
        aria-busy={recommending}
      >
        {recommending ? 'Finding alternatives…' : '✦ Ask AI for alternative slots'}
      </button>
    </div>
  );
}

/* ── RequestFormPage ─────────────────────────────────────────── */
export default function RequestFormPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const apiFetch       = useApi();

  // IDs for accessibility
  const eqId        = useId();
  const titleId     = useId();
  const purposeId   = useId();
  const deadlineId  = useId();
  const startId     = useId();
  const endId       = useId();
  const purposeHint = useId();

  // Equipment list (for selector)
  const [equipmentList, setEquipmentList] = useState([]);
  // Form fields
  const [equipmentId,   setEquipmentId]   = useState(searchParams.get('equipment') ?? '');
  const [projectTitle,  setProjectTitle]  = useState('');
  const [purpose,       setPurpose]       = useState('');
  const [deadline,      setDeadline]      = useState('');
  const [startTime,     setStartTime]     = useState('');
  const [endTime,       setEndTime]       = useState('');

  // UI state
  const [availability,  setAvailability]  = useState(null);
  const [loadingAvail,  setLoadingAvail]  = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [conflicts,     setConflicts]     = useState(null);
  const [recommending,  setRecommending]  = useState(false);
  const [aiSlots,       setAiSlots]       = useState(null);
  const [formError,     setFormError]     = useState('');
  const [fieldErrors,   setFieldErrors]   = useState({});
  const [success,       setSuccess]       = useState(false);

  // Load equipment list
  useEffect(() => {
    apiFetch('/api/equipment?status=available')
      .then(data => setEquipmentList(data))
      .catch(() => {});
  }, [apiFetch]);

  // Load availability whenever equipment selection changes
  useEffect(() => {
    if (!equipmentId) { setAvailability(null); return; }
    setLoadingAvail(true);
    apiFetch(`/api/bookings/equipment/${equipmentId}?days=30`)
      .then(data => setAvailability(data))
      .catch(() => setAvailability(null))
      .finally(() => setLoadingAvail(false));
  }, [equipmentId, apiFetch]);

  // Reset conflict + AI slots when user changes the time
  useEffect(() => { setConflicts(null); setAiSlots(null); }, [startTime, endTime]);

  function handleSelectSlot(start, end) {
    setStartTime(localIso(start));
    setEndTime(localIso(end));
    setConflicts(null);
    setAiSlots(null);
  }

  function validate() {
    const errors = {};
    if (!equipmentId)            errors.equipmentId   = 'Select a piece of equipment.';
    if (!projectTitle.trim())    errors.projectTitle  = 'Project title is required.';
    else if (projectTitle.length > MAX_PROJECT_TITLE)
                                 errors.projectTitle  = `Max ${MAX_PROJECT_TITLE} characters.`;
    if (!purpose.trim())         errors.purpose       = 'Purpose is required.';
    else if (purpose.length > MAX_PURPOSE)
                                 errors.purpose       = `Max ${MAX_PURPOSE} characters.`;
    if (!deadline)               errors.deadline      = 'Deadline is required.';
    if (!startTime)              errors.startTime     = 'Start time is required.';
    if (!endTime)                errors.endTime       = 'End time is required.';
    if (startTime && endTime && new Date(startTime) >= new Date(endTime))
                                 errors.endTime       = 'End must be after start.';
    if (startTime && new Date(startTime) <= new Date())
                                 errors.startTime     = 'Start time must be in the future.';
    if (deadline && endTime && deadline < endTime.slice(0, 10))
                                 errors.deadline      = 'Deadline cannot be before the end of your slot.';
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    setConflicts(null);
    setAiSlots(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await apiFetch('/api/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          equipment_id:  equipmentId,
          project_title: projectTitle.trim(),
          purpose:       purpose.trim(),
          deadline,
          start_time:    toIso(startTime),
          end_time:      toIso(endTime),
        }),
      });
      setSuccess(true);
    } catch (err) {
      if (err.status === 409 && err.body?.conflicts) {
        setConflicts(err.body.conflicts);
      } else {
        setFormError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecommend() {
    setRecommending(true);
    setAiSlots(null);
    try {
      const data = await apiFetch('/api/ai/recommend', {
        method: 'POST',
        body: JSON.stringify({
          equipment_id:   equipmentId,
          project_title:  projectTitle.trim() || 'My project',
          deadline:       deadline || new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
          duration_hours: startTime && endTime
            ? Math.max(1, Math.round((new Date(endTime) - new Date(startTime)) / 3600_000))
            : 2,
        }),
      });
      setAiSlots(data.slots ?? []);
    } catch {
      setFormError('AI recommendation failed — please choose a slot manually.');
    } finally {
      setRecommending(false);
    }
  }

  if (success) {
    return (
      <main id="main-content" className="page-container">
        <div className="success-card">
          <span className="success-icon" aria-hidden="true">✓</span>
          <h1 className="success-title">Request submitted!</h1>
          <p className="success-desc">
            Your access request is pending faculty approval. You'll see it on your dashboard.
          </p>
          <div className="success-actions">
            <Link to="/dashboard" className="btn btn-primary">Go to dashboard</Link>
            <Link to="/equipment" className="btn btn-outline">Browse more equipment</Link>
          </div>
        </div>
      </main>
    );
  }

  const titleRemaining   = MAX_PROJECT_TITLE - projectTitle.length;
  const purposeRemaining = MAX_PURPOSE - purpose.length;

  return (
    <main id="main-content" className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Book Equipment</h1>
          <p className="page-subtitle">Submit an access request for faculty approval</p>
        </div>
        <Link to="/equipment" className="btn btn-outline">← Back to catalogue</Link>
      </div>

      <div className="req-layout">
        {/* ── Form ──────────────────────────────────────── */}
        <section aria-labelledby="form-heading" className="req-form-section">
          <h2 id="form-heading" className="sr-only">Request form</h2>

          {formError && (
            <p role="alert" className="form-error" aria-live="assertive">{formError}</p>
          )}

          <form onSubmit={handleSubmit} noValidate aria-label="Equipment booking request">

            {/* Equipment */}
            <div className="field">
              <label htmlFor={eqId}>Equipment <span aria-hidden="true">*</span></label>
              <select
                id={eqId}
                value={equipmentId}
                onChange={e => { setEquipmentId(e.target.value); setConflicts(null); }}
                required
                aria-invalid={!!fieldErrors.equipmentId}
                aria-describedby={fieldErrors.equipmentId ? `${eqId}-err` : undefined}
              >
                <option value="">Select equipment…</option>
                {equipmentList.map(eq => (
                  <option key={eq.id} value={eq.id}>{eq.name} — {eq.department}</option>
                ))}
              </select>
              {fieldErrors.equipmentId && (
                <span id={`${eqId}-err`} className="field-error" role="alert">{fieldErrors.equipmentId}</span>
              )}
            </div>

            {/* Project title */}
            <div className="field">
              <label htmlFor={titleId}>
                Project title <span aria-hidden="true">*</span>
              </label>
              <input
                id={titleId}
                type="text"
                value={projectTitle}
                onChange={e => setProjectTitle(e.target.value)}
                maxLength={MAX_PROJECT_TITLE + 10}
                required
                aria-invalid={!!fieldErrors.projectTitle}
                aria-describedby={`${titleId}-count${fieldErrors.projectTitle ? ` ${titleId}-err` : ''}`}
                placeholder="e.g. IoT-based soil monitoring system"
              />
              <span id={`${titleId}-count`} className={`char-count${titleRemaining < 0 ? ' char-count-over' : ''}`}>
                {titleRemaining < 0 ? `${Math.abs(titleRemaining)} over limit` : `${titleRemaining} remaining`}
              </span>
              {fieldErrors.projectTitle && (
                <span id={`${titleId}-err`} className="field-error" role="alert">{fieldErrors.projectTitle}</span>
              )}
            </div>

            {/* Purpose */}
            <div className="field">
              <label htmlFor={purposeId}>
                Purpose / project description <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={purposeId}
                rows={4}
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                required
                aria-invalid={!!fieldErrors.purpose}
                aria-describedby={`${purposeHint} ${purposeId}-count${fieldErrors.purpose ? ` ${purposeId}-err` : ''}`}
                placeholder="Describe what you will use the equipment for and what your project involves…"
              />
              <span id={purposeHint} className="sr-only">Maximum {MAX_PURPOSE} characters</span>
              <span id={`${purposeId}-count`} className={`char-count${purposeRemaining < 0 ? ' char-count-over' : ''}`}
                aria-live="polite">
                {purposeRemaining < 0 ? `${Math.abs(purposeRemaining)} over limit` : `${purposeRemaining} remaining`}
              </span>
              {fieldErrors.purpose && (
                <span id={`${purposeId}-err`} className="field-error" role="alert">{fieldErrors.purpose}</span>
              )}
            </div>

            {/* Deadline */}
            <div className="field">
              <label htmlFor={deadlineId}>Project deadline <span aria-hidden="true">*</span></label>
              <input
                id={deadlineId}
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                min={today()}
                required
                aria-invalid={!!fieldErrors.deadline}
                aria-describedby={fieldErrors.deadline ? `${deadlineId}-err` : undefined}
              />
              {fieldErrors.deadline && (
                <span id={`${deadlineId}-err`} className="field-error" role="alert">{fieldErrors.deadline}</span>
              )}
            </div>

            {/* Time window */}
            <fieldset className="time-fieldset">
              <legend>Requested time slot <span aria-hidden="true">*</span></legend>
              <div className="time-row">
                <div className="field">
                  <label htmlFor={startId}>Start</label>
                  <input
                    id={startId}
                    type="datetime-local"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    min={localIso(new Date())}
                    required
                    aria-invalid={!!fieldErrors.startTime}
                    aria-describedby={fieldErrors.startTime ? `${startId}-err` : undefined}
                  />
                  {fieldErrors.startTime && (
                    <span id={`${startId}-err`} className="field-error" role="alert">{fieldErrors.startTime}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={endId}>End</label>
                  <input
                    id={endId}
                    type="datetime-local"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    min={startTime || localIso(new Date())}
                    required
                    aria-invalid={!!fieldErrors.endTime}
                    aria-describedby={fieldErrors.endTime ? `${endId}-err` : undefined}
                  />
                  {fieldErrors.endTime && (
                    <span id={`${endId}-err`} className="field-error" role="alert">{fieldErrors.endTime}</span>
                  )}
                </div>
              </div>
            </fieldset>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? 'Submitting…' : 'Submit access request'}
            </button>
          </form>

          {/* ── Conflict panel ───────────────────────── */}
          {conflicts && (
            <ConflictPanel
              conflicts={conflicts}
              onRecommend={handleRecommend}
              recommending={recommending}
            />
          )}

          {/* ── AI-recommended alternative slots ──────── */}
          {aiSlots && aiSlots.length > 0 && (
            <div className="ai-slots-panel">
              <h3 className="ai-slots-title">✦ AI-recommended alternative slots</h3>
              <ul className="slot-list" role="list">
                {aiSlots.map((slot, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="slot-item slot-free"
                      onClick={() => {
                        setStartTime(localIso(new Date(slot.start)));
                        setEndTime(localIso(new Date(slot.end)));
                        setConflicts(null);
                        setAiSlots(null);
                      }}
                    >
                      <span className="slot-label">✦ {fmtSlot(new Date(slot.start), new Date(slot.end))}</span>
                      <span className="slot-reason">{slot.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ── Availability panel ────────────────────────── */}
        <aside aria-label="Equipment availability" className="req-avail-section">
          <h2 className="section-title">Availability</h2>
          {!equipmentId && (
            <p className="avail-empty">Select equipment above to see its availability.</p>
          )}
          {loadingAvail && (
            <p className="loading-msg" aria-live="polite" aria-busy="true">Loading availability…</p>
          )}
          {!loadingAvail && availability && (
            <AvailabilityCalendar
              availability={availability}
              onSelectSlot={handleSelectSlot}
              selectedStart={startTime ? toIso(startTime) : null}
              selectedEnd={endTime ? toIso(endTime) : null}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
