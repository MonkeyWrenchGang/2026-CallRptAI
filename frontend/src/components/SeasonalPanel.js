import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmtPct } from '../utils/format';

const METRICS = [
  { key: 'median_roa', label: 'ROA', color: '#1D9E75', higherBetter: true },
  { key: 'median_nwr', label: 'Net Worth Ratio', color: '#2563eb', higherBetter: true },
  { key: 'median_delinquency', label: 'Delinquency', color: '#dc2626', higherBetter: false },
  { key: 'median_loan_to_share', label: 'Loan-to-Share', color: '#f59e0b', higherBetter: true },
];

function bestWorstLabel(quarters, key, higherBetter) {
  if (!quarters || quarters.length === 0) return { best: null, worst: null };
  const sorted = [...quarters].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0));
  if (higherBetter) {
    return { best: sorted[sorted.length - 1]?.quarter, worst: sorted[0]?.quarter };
  }
  return { best: sorted[0]?.quarter, worst: sorted[sorted.length - 1]?.quarter };
}

export default function SeasonalPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch('/api/ncua/seasonal-patterns')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load seasonal data');
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const quarters = data?.quarters || [];

  const chartData = quarters.map((q) => ({
    quarter: q.quarter,
    ROA: q.median_roa != null ? +(q.median_roa * 100).toFixed(4) : 0,
    NWR: q.median_nwr != null ? +(q.median_nwr * 100).toFixed(4) : 0,
    Delinquency: q.median_delinquency != null ? +(q.median_delinquency * 100).toFixed(4) : 0,
    'Loan/Share': q.median_loan_to_share != null ? +(q.median_loan_to_share * 100).toFixed(2) : 0,
  }));

  return (
    <main className="compare-area seasonal-panel">
      <header className="compare-header">
        <h2>Seasonal Patterns</h2>
        {data?.years_covered && (
          <span className="compare-quarter-label">
            {data.years_covered} years of data
          </span>
        )}
      </header>

      {loading && <p className="compare-message">Loading seasonal data...</p>}
      {error && <p className="compare-message error">{error}</p>}

      {!loading && quarters.length > 0 && (
        <>
          {/* Grouped bar chart */}
          <section className="seasonal-chart-section">
            <h3>Median Metrics by Quarter (%)</h3>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="quarter" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${v.toFixed(4)}%`} />
                  <Legend />
                  <Bar dataKey="ROA" fill="#1D9E75" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="NWR" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Delinquency" fill="#dc2626" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Loan/Share" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Table with median values */}
          <section className="compare-table-wrap">
            <div className="table-title">
              <h3>Median Values by Quarter</h3>
            </div>
            <div className="compare-table-scroll">
              <table className="compare-table seasonal-table">
                <thead>
                  <tr>
                    <th>Quarter</th>
                    {METRICS.map((m) => (
                      <th key={m.key}>{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quarters.map((q) => (
                    <tr key={q.quarter}>
                      <td className="metric-col-label">{q.quarter}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="mono">
                          {fmtPct(q[m.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Best/Worst quarter highlights */}
          <section className="seasonal-highlights">
            <h3>Seasonal Highlights</h3>
            <div className="seasonal-highlights-grid">
              {METRICS.map((m) => {
                const { best, worst } = bestWorstLabel(quarters, m.key, m.higherBetter);
                return (
                  <div key={m.key} className="seasonal-highlight-card">
                    <div className="seasonal-highlight-label">{m.label}</div>
                    <div className="seasonal-highlight-row">
                      <span className="seasonal-best">Strongest: {best || '--'}</span>
                      <span className="seasonal-worst">Weakest: {worst || '--'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {!loading && !error && quarters.length === 0 && (
        <p className="compare-message">No seasonal pattern data available.</p>
      )}
    </main>
  );
}
