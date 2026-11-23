import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / 86400_000);
}

function KpiCard({ label, value, accent, to }) {
  const content = (
    <div className={`kpi-card${accent ? ` kpi-${accent}` : ''}`}>
      <span className="kpi-value" aria-label={`${value} ${label}`}>{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
  return to ? <Link to={to} className="kpi-link">{content}</Link> : content;
}

function DeadlineRow({ item, role }) {
  const days  = daysUntil(item.deadline);
  const urgent = days <= 2;
  return (
    <li className={`deadline-row${urgent ? ' deadline-urgent' : ''}`}>
      <div className="deadline-info">
        <span className="deadline-title">{item.project_title}</span>
        <span className="deadline-equip">{item.equipment?.name}</span>
        {role !== 'student' && (
          <span className="deadline-student">{item.profiles?.name}</span>
        )}
      </div>
      <span
        className="deadline-badge"
        aria-label={`Due in ${days} day${days !== 1 ? 's' : ''}`}
      >
        {days === 0 ? 'Today' : days < 0 ? 'Overdue' : `${days}d`}
      </span>
    </li>
  );
}

// ── Student request status feed ───────────────────────────────

const STATUS_CONFIG = {
  pending:  { cls: 'badge-amber', label: 'Pending' },
  approved: { cls: 'badge-green', label: 'Approved' },
  rejected: { cls: 'badge-red',   label: 'Rejected' },
};

function RequestStatusFeed({ requests }) {
  if (!requests?.length) return (
    <p className="feed-empty">No requests yet. <Link to="/equipment">Browse equipment</Link> to get started.</p>
  );

  return (
    <ul className="status-feed" role="list" aria-label="Your recent requests">
      {requests.map(r => {
        const cfg = STATUS_CONFIG[r.status] ?? { cls: 'badge-gray', label: r.status };
        return (
          <li key={r.id} className="status-feed-item">
            <div className="feed-item-info">
              <span className="feed-project">{r.project_title}</span>
              <span className="feed-equip">{r.equipment?.name}</span>
              {r.faculty_note && r.status !== 'pending' && (
                <span className="feed-note">Faculty note: "{r.faculty_note}"</span>
              )}
            </div>
            <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Faculty recent activity feed ──────────────────────────────

function ActivityFeed({ activity }) {
  if (!activity?.length) return <p className="feed-empty">No recent activity.</p>;

  return (
    <ul className="status-feed" role="list" aria-label="Recent activity">
      {activity.map((item, i) => {
        const isApproved = item.status === 'approved';
        return (
          <li key={`${item.id}-${i}`} className="status-feed-item">
            <div className="feed-item-info">
              <span className="feed-project">{item.project_title}</span>
              <span className="feed-equip">
                {item.equipment?.name}
                {item.profiles?.name ? ` · ${item.profiles.name}` : ''}
              </span>
            </div>
            <span className={`badge ${isApproved ? 'badge-green' : 'badge-red'}`}>
              {item.status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const apiFetch    = useApi();
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await apiFetch('/api/dashboard');
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const role = profile?.role;

  return (
    <main id="main-content" className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Welcome back, {profile?.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="page-subtitle">
            {role === 'student'
              ? `${profile.department} · Student`
              : `${profile?.department} · ${role === 'faculty' ? 'Faculty' : 'Admin'}`}
          </p>
        </div>
        {role === 'student' && (
          <Link to="/requests/new" className="btn btn-primary">+ Book Equipment</Link>
        )}
        {(role === 'faculty' || role === 'admin') && (
          <Link to="/approvals" className="btn btn-primary">Review Approvals</Link>
        )}
      </div>

      {error && <p role="alert" className="form-error">{error}</p>}

      {loading ? (
        <p className="loading-msg" aria-live="polite" aria-busy="true">Loading dashboard…</p>
      ) : data && (
        <>
          {/* ── KPI cards ───────────────────────────────── */}
          <section aria-labelledby="kpi-heading">
            <h2 id="kpi-heading" className="section-title">Overview</h2>
            <div className="kpi-grid" role="list">
              {role === 'student' ? (
                <>
                  <KpiCard label="Active bookings"    value={data.activeBookings}  accent="blue"  to="/bookings" />
                  <KpiCard label="Pending requests"   value={data.pendingRequests} accent="amber" to="/requests" />
                  <KpiCard label="Upcoming deadlines" value={data.upcomingDeadlines.length} accent="red" />
                </>
              ) : (
                <>
                  <KpiCard label="Awaiting approval"   value={data.pendingApprovals}    accent="amber" to="/approvals" />
                  <KpiCard label="Approved today"       value={data.approvedToday}       accent="green" />
                  <KpiCard label="Active bookings"      value={data.totalActiveBookings} accent="blue" />
                  <KpiCard label="Urgent deadlines"     value={data.upcomingDeadlines.length} accent="red" />
                </>
              )}
            </div>
          </section>

          {/* ── Next booking (student) ───────────────────── */}
          {role === 'student' && data.nextBooking && (
            <section aria-labelledby="next-booking-heading" className="dashboard-section">
              <h2 id="next-booking-heading" className="section-title">Your next booking</h2>
              <div className="next-booking-card">
                <div>
                  <p className="nb-equip">{data.nextBooking.equipment?.name}</p>
                  <p className="nb-loc">{data.nextBooking.equipment?.location}</p>
                </div>
                <div className="nb-time">
                  <span>{fmt(data.nextBooking.start_time)}</span>
                  <span className="nb-sep">→</span>
                  <span>{fmt(data.nextBooking.end_time)}</span>
                </div>
              </div>
            </section>
          )}

          {/* ── Student request status feed ───────────── */}
          {role === 'student' && (
            <section aria-labelledby="status-feed-heading" className="dashboard-section">
              <h2 id="status-feed-heading" className="section-title">Your requests</h2>
              <RequestStatusFeed requests={data.myRequests} />
            </section>
          )}

          {/* ── Upcoming deadlines ───────────────────────── */}
          {data.upcomingDeadlines.length > 0 && (
            <section aria-labelledby="deadlines-heading" className="dashboard-section">
              <h2 id="deadlines-heading" className="section-title">
                {role === 'student' ? 'Upcoming project deadlines' : 'Requests expiring soon'}
              </h2>
              <ul className="deadline-list" role="list">
                {data.upcomingDeadlines.map(item => (
                  <DeadlineRow key={item.id} item={item} role={role} />
                ))}
              </ul>
            </section>
          )}

          {/* ── Faculty: pending approvals table ─────────── */}
          {(role === 'faculty' || role === 'admin') && data.pendingList?.length > 0 && (
            <section aria-labelledby="pending-heading" className="dashboard-section">
              <h2 id="pending-heading" className="section-title">Pending approval requests</h2>
              <div className="table-wrapper" role="region" aria-label="Pending requests table" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Equipment</th>
                      <th scope="col">Project</th>
                      <th scope="col">Deadline</th>
                      <th scope="col"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pendingList.map(r => (
                      <tr key={r.id}>
                        <td>{r.profiles?.name ?? '—'}</td>
                        <td>{r.equipment?.name ?? '—'}</td>
                        <td>{r.project_title}</td>
                        <td>
                          <span className={daysUntil(r.deadline) <= 2 ? 'text-urgent' : ''}>
                            {r.deadline}
                          </span>
                        </td>
                        <td>
                          <Link to={`/approvals?id=${r.id}`} className="btn btn-sm btn-outline">
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Faculty: recent activity feed ─────────────── */}
          {(role === 'faculty' || role === 'admin') && (
            <section aria-labelledby="activity-heading" className="dashboard-section">
              <h2 id="activity-heading" className="section-title">Recent activity</h2>
              <ActivityFeed activity={data.recentActivity} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
