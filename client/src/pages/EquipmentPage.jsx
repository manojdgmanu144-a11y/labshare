import { useEffect, useState, useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import AskAI from '../components/AskAI';

const STATUS_LABELS = {
  available:   { label: 'Available',   cls: 'badge-green' },
  in_use:      { label: 'In use',      cls: 'badge-amber' },
  maintenance: { label: 'Maintenance', cls: 'badge-red'   },
  retired:     { label: 'Retired',     cls: 'badge-gray'  },
};

function StatusBadge({ status }) {
  const { label, cls } = STATUS_LABELS[status] ?? { label: status, cls: 'badge-gray' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function EquipmentCard({ item, reason }) {
  return (
    <article className="eq-card" aria-label={item.name}>
      <div className="eq-card-header">
        <div>
          <h3 className="eq-card-name">{item.name}</h3>
          <p className="eq-card-meta">{item.category} · {item.department}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <p className="eq-card-desc">{item.description}</p>
      {reason && (
        <p className="eq-card-reason">
          <span aria-hidden="true">✦ </span>{reason}
        </p>
      )}
      <div className="eq-card-footer">
        <span className="eq-card-loc">
          <span aria-hidden="true">📍 </span>{item.location}
        </span>
        {item.status === 'available' && (
          <Link
            to={`/requests/new?equipment=${item.id}`}
            className="btn btn-sm btn-primary"
          >
            Book
          </Link>
        )}
      </div>
    </article>
  );
}

export default function EquipmentPage() {
  const apiFetch = useApi();

  // Filter state
  const [search,     setSearch]     = useState('');
  const [department, setDepartment] = useState('');
  const [category,   setCategory]   = useState('');
  const [status,     setStatus]     = useState('');

  // Data state
  const [items,       setItems]       = useState([]);
  const [meta,        setMeta]        = useState({ departments: [], categories: [] });
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  // AI results override — null means "show filtered list", array means "show AI list"
  const [aiResults,   setAiResults]   = useState(null);

  const deptId   = useId();
  const catId    = useId();
  const statId   = useId();
  const searchId = useId();

  // Load filter meta once
  useEffect(() => {
    apiFetch('/api/equipment/meta')
      .then(d => setMeta(d))
      .catch(() => {}); // non-fatal
  }, [apiFetch]);

  // Fetch catalogue whenever filters change (debounced for search input)
  const fetchItems = useCallback(async (params) => {
    setLoading(true);
    setError('');
    setAiResults(null); // clear AI on any filter change
    try {
      const qs = new URLSearchParams();
      if (params.search)     qs.set('search',     params.search);
      if (params.department) qs.set('department', params.department);
      if (params.category)   qs.set('category',   params.category);
      if (params.status)     qs.set('status',      params.status);
      const data = await apiFetch(`/api/equipment?${qs}`);
      setItems(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  // Debounce the search param so we don't fire on every keystroke
  useEffect(() => {
    const id = setTimeout(() => {
      fetchItems({ search, department, category, status });
    }, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [search, department, category, status, fetchItems]);

  function handleReset() {
    setSearch('');
    setDepartment('');
    setCategory('');
    setStatus('');
    setAiResults(null);
  }

  const displayItems   = aiResults ?? items;
  const hasActiveFilter = search || department || category || status;

  return (
    <main id="main-content" className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipment Catalogue</h1>
          <p className="page-subtitle">
            {displayItems.length} item{displayItems.length !== 1 ? 's' : ''}
            {aiResults ? ' — AI results' : hasActiveFilter ? ' — filtered' : ' available'}
          </p>
        </div>
      </div>

      {/* ── Ask AI ─────────────────────────────────────── */}
      <AskAI onResults={setAiResults} />

      {/* ── Filters + catalogue ─────────────────────────── */}
      <div className="eq-layout">

        {/* Sidebar filters */}
        <aside className="eq-sidebar" aria-label="Filters">
          <div className="sidebar-header">
            <h2 className="sidebar-title">Filters</h2>
            {hasActiveFilter && (
              <button type="button" className="btn-link" onClick={handleReset}>
                Reset all
              </button>
            )}
          </div>

          <div className="field">
            <label htmlFor={searchId}>Keyword search</label>
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="e.g. oscilloscope"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={statId}>Availability</label>
            <select id={statId} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="in_use">In use</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor={deptId}>Department</label>
            <select id={deptId} value={department} onChange={e => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {meta.departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor={catId}>Category</label>
            <select id={catId} value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {meta.categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </aside>

        {/* Main grid */}
        <div className="eq-main" aria-live="polite" aria-busy={loading}>
          {error && (
            <p role="alert" className="form-error">{error}</p>
          )}

          {loading ? (
            <p className="loading-msg">Loading equipment…</p>
          ) : displayItems.length === 0 ? (
            <div className="eq-empty">
              <p className="eq-empty-title">No equipment found</p>
              <p className="eq-empty-hint">
                {aiResults
                  ? 'AI found no matches — try rephrasing, or use the filters.'
                  : 'Try adjusting the filters or search term.'}
              </p>
              {(hasActiveFilter || aiResults) && (
                <button type="button" className="btn btn-outline" onClick={handleReset}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <ul className="eq-grid" role="list">
              {displayItems.map(item => (
                <li key={item.id}>
                  <EquipmentCard item={item} reason={item.reason} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
