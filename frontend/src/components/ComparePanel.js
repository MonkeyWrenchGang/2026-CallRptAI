import React, { useState, useEffect, useRef } from 'react';
import { fmtPct, fmtMembers } from '../utils/format';

const TEAL = '#1D9E75';
const COLORS = ['#1D9E75', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const DEFAULT_CU_NUMBERS = ['5536', '227', '62604']; // Navy Federal, Pentagon, Boeing Employees

// Fallback name cache so chips show names before API data loads
const NAME_CACHE = {
  '5536':  'Navy Federal CU',
  '66310': "State Employees' CU",
  '227':   'Pentagon Federal CU',
  '62604': 'Boeing Employees CU',
  '24212': 'SchoolsFirst FCU',
  '61650': 'The Golden 1 CU',
};

const METRIC_ROWS = [
  { key: 'roa',               label: 'ROA',               pctKey: 'roa',              fmt: (v) => fmtPct(v) },
  { key: 'net_worth_ratio',   label: 'Net Worth Ratio',   pctKey: 'net_worth_ratio',  fmt: (v) => fmtPct(v) },
  { key: 'delinquency_ratio', label: 'Delinquency Rate',  pctKey: 'delinquency_ratio',fmt: (v) => fmtPct(v) },
  { key: 'loan_to_share_ratio', label: 'Loan-to-Share',   pctKey: 'loan_to_share',    fmt: (v) => fmtPct(v) },
  { key: 'member_count',      label: 'Members',           pctKey: null,               fmt: (v) => fmtMembers(v) },
  { key: 'efficiency_ratio',  label: 'Efficiency Ratio',  pctKey: 'efficiency_ratio', fmt: (v) => fmtPct(v) },
];

function MultiLineTrend({ cus, width = 560, height = 120 }) {
  if (!cus || cus.length === 0) return null;

  // Gather all ROA values across all CUs to normalize
  const allVals = cus.flatMap((cu) =>
    (cu.trend || []).map((t) => Number(t.roa ?? 0) * 100)
  );
  if (allVals.length === 0) return null;

  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 0.001;
  const padX = 10;
  const padY = 8;
  const w = width - padX * 2;
  const h = height - padY * 2;

  return (
    <svg
      width={width}
      height={height}
      aria-label="ROA trend chart"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {cus.map((cu, ci) => {
        const pts = (cu.trend || []);
        if (pts.length < 2) return null;
        const points = pts
          .map((t, i) => {
            const x = padX + (i / (pts.length - 1)) * w;
            const v = Number(t.roa ?? 0) * 100;
            const y = padY + h - ((v - min) / range) * h;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
        return (
          <polyline
            key={cu.institution?.cu_number || ci}
            points={points}
            fill="none"
            stroke={COLORS[ci % COLORS.length]}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

export default function ComparePanel({ activeCU, onSendChat }) {
  const [cuNumbers, setCuNumbers] = useState(DEFAULT_CU_NUMBERS);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch(`/api/ncua/search?q=${encodeURIComponent(searchQuery.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          setSearchResults(Array.isArray(d) ? d : (d.results || []));
          setSearching(false);
        })
        .catch(() => {
          setSearchResults([]);
          setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [searchQuery]);

  // Auto-add activeCU when it changes
  useEffect(() => {
    if (!activeCU) return;
    setCuNumbers((prev) =>
      prev.includes(activeCU) ? prev : [activeCU, ...prev].slice(0, 8)
    );
  }, [activeCU]);

  // Fetch compare data when cuNumbers changes
  useEffect(() => {
    if (cuNumbers.length === 0) {
      setData(null);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/ncua/compare?cu_numbers=${cuNumbers.join(',')}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load compare data');
        return r.json();
      })
      .then((d) => {
        if (!cancelled) { setData(d); setLoading(false); }
      })
      .catch((e) => {
        if (!cancelled) { setError(e.message || 'Error loading data'); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [cuNumbers]);

  const addCU = (cu_number) => {
    const n = String(cu_number).trim();
    if (!n) return;
    setCuNumbers((prev) =>
      prev.includes(n) || prev.length >= 8 ? prev : [...prev, n]
    );
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeCU = (cu_number) => {
    setCuNumbers((prev) => prev.filter((x) => x !== cu_number));
  };

  const handleExplainGaps = () => {
    if (!onSendChat) return;
    const names = (data?.cus || []).map((c) => c.institution?.name).filter(Boolean).join(', ');
    onSendChat(`Explain the performance gaps between: ${names}. Focus on ROA, net worth ratio, and delinquency differences.`);
  };

  const cus = data?.cus || [];

  return (
    <main className="compare-area">
      <header className="compare-header">
        <h2>Compare Credit Unions</h2>
        {data?.quarter && (
          <span className="compare-quarter-label">Data: {data.quarter}</span>
        )}
      </header>

      {/* CU selector */}
      <section className="compare-controls">
        <div className="compare-tray">
          {cuNumbers.length === 0 && (
            <span className="tray-empty">No credit unions selected</span>
          )}
          {cuNumbers.map((num, ci) => {
            const cu = cus.find((c) => c.institution?.cu_number === num);
            const label = cu ? cu.institution.name : (NAME_CACHE[num] || num);
            return (
              <span key={num} className="tray-chip" style={{ borderColor: COLORS[ci % COLORS.length] }}>
                <span
                  className="tray-chip-dot"
                  style={{ background: COLORS[ci % COLORS.length] }}
                />
                {label}
                <button
                  type="button"
                  onClick={() => removeCU(num)}
                  aria-label={`Remove ${label}`}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>

        <div className="compare-search-row">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search to add a credit union…"
          />
        </div>

        {(searching || searchResults.length > 0) && (
          <div className="compare-search-results">
            {searching && <div className="compare-search-item muted">Searching…</div>}
            {searchResults.map((r) => (
              <div
                key={r.cu_number}
                className="compare-search-item"
                role="button"
                tabIndex={0}
                onClick={() => addCU(r.cu_number)}
                onKeyDown={(e) => { if (e.key === 'Enter') addCU(r.cu_number); }}
              >
                <span className="inst-name-text">{r.name}</span>
                <span className="inst-meta-text">{r.state} · #{r.cu_number}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Loading / error states */}
      {loading && <p className="compare-message">Loading comparison data…</p>}
      {error && <p className="compare-message error">{error}</p>}

      {!loading && cus.length > 0 && (
        <>
          {/* Comparison table */}
          <section className="compare-table-wrap">
            <div className="table-title">
              <h3>Metric comparison</h3>
              {data?.national_cu_count && (
                <span className="table-sub">National: {data.national_cu_count.toLocaleString()} CUs</span>
              )}
            </div>
            <div className="compare-table-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th className="metric-col">Metric</th>
                    {cus.map((cu, ci) => (
                      <th key={cu.institution.cu_number} className="cu-col">
                        <span
                          className="cu-col-dot"
                          style={{ background: COLORS[ci % COLORS.length] }}
                        />
                        {cu.institution.name}
                        <span className="cu-col-state">{cu.institution.state}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td className="metric-col-label">{row.label}</td>
                      {cus.map((cu, ci) => {
                        const val = cu.latest?.[row.key];
                        const pct = row.pctKey
                          ? (cu.national_percentiles?.[row.pctKey] ?? null)
                          : null;
                        return (
                          <td key={cu.institution.cu_number} className="metric-cell">
                            <div className="cell-value mono">{row.fmt(val)}</div>
                            {pct != null && (
                              <div className="pct-bar-wrap" title={`${Math.round(pct)}th percentile nationally`}>
                                <div
                                  className="pct-bar-fill"
                                  style={{
                                    width: `${pct}%`,
                                    background: COLORS[ci % COLORS.length],
                                  }}
                                />
                                <span className="pct-bar-label">{Math.round(pct)}th</span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Multi-line ROA trend chart */}
          <section className="compare-chart-section">
            <div className="table-title">
              <h3>ROA trend (8 quarters)</h3>
            </div>
            <div className="chart-legend">
              {cus.map((cu, ci) => (
                <span key={cu.institution.cu_number} className="legend-item">
                  <span
                    className="legend-dot"
                    style={{ background: COLORS[ci % COLORS.length] }}
                  />
                  {cu.institution.name}
                </span>
              ))}
            </div>
            <div className="chart-scroll">
              <MultiLineTrend cus={cus} width={Math.max(480, cus.length * 120)} height={130} />
            </div>
            {cus[0]?.trend?.length > 0 && (
              <div className="chart-x-labels">
                <span>{cus[0].trend[0]?.quarter_label}</span>
                <span>{cus[0].trend[cus[0].trend.length - 1]?.quarter_label}</span>
              </div>
            )}
          </section>

          {/* Explain gaps button */}
          {onSendChat && (
            <div className="compare-actions">
              <button
                type="button"
                className="explain-gaps-btn"
                onClick={handleExplainGaps}
              >
                Explain these gaps
              </button>
            </div>
          )}
        </>
      )}

      {!loading && !error && cuNumbers.length === 0 && (
        <p className="compare-message">Search and add credit unions to compare.</p>
      )}
    </main>
  );
}
