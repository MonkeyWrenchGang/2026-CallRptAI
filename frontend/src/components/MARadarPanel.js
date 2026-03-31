import React, { useState, useEffect } from 'react';
import { fmtAssets, fmtPct, fmtMembers } from '../utils/format';
import { downloadCSV } from '../utils/csv';

const FLAG_CONFIG = {
  small_assets:          { label: 'Small',       color: '#6b7280', bg: '#f3f4f6' },
  nwr_critical:          { label: 'NWR < 7%',    color: '#991b1b', bg: '#fee2e2' },
  nwr_declining:         { label: 'NWR \u2193',  color: '#b45309', bg: '#fef3c7' },
  membership_declining:  { label: 'Mbrs \u2193', color: '#b45309', bg: '#fef3c7' },
  high_efficiency:       { label: 'Eff > 85%',   color: '#7c2d12', bg: '#ffedd5' },
  high_delinquency:      { label: 'Delinq > 2%', color: '#991b1b', bg: '#fee2e2' },
};

export default function MARadarPanel({ onSelectInstitution }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('');
  const [sortField, setSortField] = useState('risk_score');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setLoading(true);
    const url = stateFilter
      ? `/api/ncua/ma-radar?state=${stateFilter}`
      : '/api/ncua/ma-radar';
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [stateFilter]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const candidates = (data?.candidates || []).slice().sort((a, b) => {
    const av = a[sortField], bv = b[sortField];
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Gather unique states for filter dropdown
  const allStates = [...new Set((data?.candidates || []).map((c) => c.state))].sort();

  return (
    <main className="compare-area">
      <header className="compare-header">
        <h2>M&A Radar</h2>
        {data?.quarter && <span className="compare-quarter-label">{data.quarter}</span>}
      </header>

      <p className="ma-radar-desc">
        Credit unions matching acquisition risk profiles: small assets (&lt;$100M),
        low/declining net worth ratio, membership decline, or high efficiency ratio.
      </p>

      {loading && <p className="compare-message">Scanning for acquisition candidates...</p>}

      {!loading && (
        <>
          <div className="pulse-kpi-grid" style={{ marginBottom: 16 }}>
            <div className="pulse-kpi pulse-kpi-warn">
              <div className="pulse-kpi-label">Candidates Found</div>
              <div className="pulse-kpi-value mono">{candidates.length}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Avg Assets</div>
              <div className="pulse-kpi-value mono">
                {fmtAssets(
                  candidates.length > 0
                    ? candidates.reduce((s, c) => s + (c.total_assets || 0), 0) / candidates.length
                    : 0
                )}
              </div>
            </div>
            <div className="pulse-kpi pulse-kpi-danger">
              <div className="pulse-kpi-label">NWR Critical (&lt;7%)</div>
              <div className="pulse-kpi-value mono">
                {candidates.filter((c) => c.flags?.includes('nwr_critical')).length}
              </div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">States Represented</div>
              <div className="pulse-kpi-value mono">{allStates.length}</div>
            </div>
          </div>

          <div className="ma-filter-row">
            <label>
              Filter by state:
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                <option value="">All states</option>
                {allStates.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </label>
            {candidates.length > 0 && (
              <button
                type="button"
                className="export-csv-btn"
                onClick={() => {
                  const columns = ['Name', 'State', 'Assets', 'NWR', 'Members', 'Efficiency', 'Delinquency', 'Risk Score', 'Flags'];
                  const rows = candidates.map((c) => ({
                    Name: c.name,
                    State: c.state,
                    Assets: c.total_assets,
                    NWR: c.nwr_curr != null ? (c.nwr_curr * 100).toFixed(2) + '%' : '',
                    Members: c.members_curr,
                    Efficiency: c.efficiency_ratio != null ? (c.efficiency_ratio * 100).toFixed(2) + '%' : '',
                    Delinquency: c.delinquency_ratio != null ? (c.delinquency_ratio * 100).toFixed(2) + '%' : '',
                    'Risk Score': c.risk_score,
                    Flags: (c.flags || []).join('; '),
                  }));
                  downloadCSV(columns, rows, 'ma-radar.csv');
                }}
              >
                Export CSV
              </button>
            )}
          </div>

          {candidates.length > 0 && (
            <div className="landscape-table-wrap">
              <table className="landscape-table ma-table">
                <thead>
                  <tr>
                    {[
                      { key: 'name', label: 'Name' },
                      { key: 'state', label: 'State' },
                      { key: 'total_assets', label: 'Assets' },
                      { key: 'nwr_curr', label: 'NWR' },
                      { key: 'members_curr', label: 'Members' },
                      { key: 'efficiency_ratio', label: 'Efficiency' },
                      { key: 'delinquency_ratio', label: 'Delinq.' },
                      { key: 'risk_score', label: 'Risk Score' },
                    ].map((f) => (
                      <th
                        key={f.key}
                        className={`sortable ${sortField === f.key ? 'sorted' : ''}`}
                        onClick={() => handleSort(f.key)}
                      >
                        {f.label}
                        {sortField === f.key && (
                          <span className="sort-arrow">{sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}</span>
                        )}
                      </th>
                    ))}
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.cu_number}>
                      <td>
                        <button
                          type="button"
                          className="pulse-link"
                          onClick={() => onSelectInstitution({
                            cu_number: c.cu_number, name: c.name, state: c.state,
                          })}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td>{c.state}</td>
                      <td className="mono">{fmtAssets(c.total_assets)}</td>
                      <td className={`mono ${(c.nwr_curr || 0) < 0.07 ? 'text-neg' : ''}`}>
                        {fmtPct(c.nwr_curr)}
                        {c.nwr_prev1 != null && c.nwr_curr != null && c.nwr_curr < c.nwr_prev1 && (
                          <span className="qoq-down"> \u25BC</span>
                        )}
                      </td>
                      <td className="mono">
                        {fmtMembers(c.members_curr)}
                        {c.members_prev1 != null && c.members_curr != null && c.members_curr < c.members_prev1 && (
                          <span className="qoq-down"> \u25BC</span>
                        )}
                      </td>
                      <td className={`mono ${(c.efficiency_ratio || 0) > 0.85 ? 'text-neg' : ''}`}>
                        {fmtPct(c.efficiency_ratio)}
                      </td>
                      <td className={`mono ${(c.delinquency_ratio || 0) > 0.02 ? 'text-neg' : ''}`}>
                        {fmtPct(c.delinquency_ratio)}
                      </td>
                      <td className="mono">
                        <span className={`risk-score-badge ${
                          c.risk_score >= 4 ? 'risk-high' : c.risk_score >= 3 ? 'risk-med' : 'risk-low'
                        }`}>
                          {c.risk_score}
                        </span>
                      </td>
                      <td className="flags-cell">
                        {(c.flags || []).map((f) => {
                          const cfg = FLAG_CONFIG[f] || { label: f, color: '#666', bg: '#eee' };
                          return (
                            <span key={f} className="flag-pill" style={{ color: cfg.color, background: cfg.bg }}>
                              {cfg.label}
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {candidates.length === 0 && (
            <p className="compare-message">No acquisition candidates match the current filters.</p>
          )}
        </>
      )}
    </main>
  );
}
