import React, { useState, useEffect } from 'react';
import { fmtAssets, fmtPct, fmtMembers } from '../utils/format';
import { downloadCSV } from '../utils/csv';

const SORT_FIELDS = [
  { key: 'state', label: 'State' },
  { key: 'cu_count', label: 'CUs' },
  { key: 'total_assets', label: 'Total Assets' },
  { key: 'total_members', label: 'Members' },
  { key: 'avg_roa', label: 'Avg ROA' },
  { key: 'avg_nwr', label: 'Avg NWR' },
  { key: 'avg_delinquency', label: 'Avg Delinq.' },
  { key: 'avg_efficiency', label: 'Avg Efficiency' },
  { key: 'health_score', label: 'Health' },
  { key: 'below_7pct', label: 'Below 7%' },
];

function healthColor(score) {
  if (score >= 75) return '#dcfce7';
  if (score >= 50) return '#fef9c3';
  return '#fee2e2';
}

function metricColor(val, green, red, invert = false) {
  if (val == null) return 'transparent';
  const isGood = invert ? val < green : val > green;
  const isBad = invert ? val > red : val < red;
  if (isGood) return 'rgba(5, 150, 105, 0.08)';
  if (isBad) return 'rgba(220, 38, 38, 0.08)';
  return 'transparent';
}

export default function LandscapePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState('total_assets');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    fetch('/api/ncua/landscape')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'state' ? 'asc' : 'desc');
    }
  };

  const states = (data?.states || []).slice().sort((a, b) => {
    const av = a[sortField], bv = b[sortField];
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totals = states.reduce(
    (acc, s) => ({
      cus: acc.cus + (s.cu_count || 0),
      assets: acc.assets + (s.total_assets || 0),
      members: acc.members + (s.total_members || 0),
    }),
    { cus: 0, assets: 0, members: 0 }
  );

  return (
    <main className="compare-area">
      <header className="compare-header">
        <h2>Competitive Landscape</h2>
        {data?.quarter && <span className="compare-quarter-label">{data.quarter}</span>}
        {states.length > 0 && (
          <button
            type="button"
            className="export-csv-btn"
            onClick={() => {
              const columns = ['State', 'CUs', 'Total Assets', 'Members', 'Avg ROA', 'Avg NWR', 'Avg Delinq.', 'Avg Efficiency', 'Health', 'Below 7%'];
              const rows = states.map((s) => ({
                State: s.state,
                CUs: s.cu_count,
                'Total Assets': s.total_assets,
                Members: s.total_members,
                'Avg ROA': s.avg_roa != null ? (s.avg_roa * 100).toFixed(2) + '%' : '',
                'Avg NWR': s.avg_nwr != null ? (s.avg_nwr * 100).toFixed(2) + '%' : '',
                'Avg Delinq.': s.avg_delinquency != null ? (s.avg_delinquency * 100).toFixed(2) + '%' : '',
                'Avg Efficiency': s.avg_efficiency != null ? (s.avg_efficiency * 100).toFixed(2) + '%' : '',
                Health: s.health_score,
                'Below 7%': s.below_7pct || 0,
              }));
              downloadCSV(columns, rows, 'landscape.csv');
            }}
          >
            Export CSV
          </button>
        )}
      </header>

      {loading && <p className="compare-message">Loading landscape data...</p>}

      {!loading && states.length > 0 && (
        <>
          <div className="pulse-kpi-grid" style={{ marginBottom: 16 }}>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">States / Territories</div>
              <div className="pulse-kpi-value mono">{states.length}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Total CUs</div>
              <div className="pulse-kpi-value mono">{totals.cus.toLocaleString()}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Total Assets</div>
              <div className="pulse-kpi-value mono">{fmtAssets(totals.assets)}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Total Members</div>
              <div className="pulse-kpi-value mono">{fmtMembers(totals.members)}</div>
            </div>
          </div>

          <div className="landscape-table-wrap">
            <table className="landscape-table">
              <thead>
                <tr>
                  {SORT_FIELDS.map((f) => (
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
                </tr>
              </thead>
              <tbody>
                {states.map((s) => (
                  <tr key={s.state}>
                    <td className="state-cell"><strong>{s.state}</strong></td>
                    <td className="mono">{s.cu_count?.toLocaleString()}</td>
                    <td className="mono">{fmtAssets(s.total_assets)}</td>
                    <td className="mono">{fmtMembers(s.total_members)}</td>
                    <td className="mono" style={{ background: metricColor(s.avg_roa, 0.006, 0.003) }}>
                      {fmtPct(s.avg_roa)}
                    </td>
                    <td className="mono" style={{ background: metricColor(s.avg_nwr, 0.10, 0.08) }}>
                      {fmtPct(s.avg_nwr)}
                    </td>
                    <td className="mono" style={{ background: metricColor(s.avg_delinquency, 0.01, 0.02, true) }}>
                      {fmtPct(s.avg_delinquency)}
                    </td>
                    <td className="mono" style={{ background: metricColor(s.avg_efficiency, 0.70, 0.85, true) }}>
                      {fmtPct(s.avg_efficiency)}
                    </td>
                    <td className="mono" style={{ background: healthColor(s.health_score) }}>
                      <strong>{s.health_score}</strong>
                    </td>
                    <td className="mono">{s.below_7pct || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
