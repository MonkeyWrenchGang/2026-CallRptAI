import React, { useState, useEffect } from 'react';
import { fmtPct } from '../utils/format';

export default function AnomalyPanel({ onSelectInstitution }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ncua/anomalies?limit=200')
      .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <section className="compare-area">
        <div className="compare-header"><h2>Anomaly Detection</h2></div>
        <p className="compare-message">Scanning for anomalies...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="compare-area">
        <div className="compare-header"><h2>Anomaly Detection</h2></div>
        <p className="compare-message error">Could not load anomaly data. Is the backend running?</p>
      </section>
    );
  }

  const anomalies = data?.anomalies || [];
  const sorted = [...anomalies].sort((a, b) =>
    sortAsc ? Math.abs(a.z_score) - Math.abs(b.z_score) : Math.abs(b.z_score) - Math.abs(a.z_score)
  );

  const directionBadge = (direction, metric) => {
    // Spike in delinquency = bad (red), drop in delinquency = good (green)
    // Spike in ROA/NWR = good (green), drop = bad (red)
    let color;
    if (metric === 'Delinquency') {
      color = direction === 'spike' ? 'badge-red' : 'badge-green';
    } else {
      color = direction === 'spike' ? 'badge-green' : 'badge-red';
    }
    return <span className={`anomaly-badge ${color}`}>{direction}</span>;
  };

  return (
    <section className="compare-area anomaly-view">
      <div className="compare-header">
        <h2>Anomaly Detection</h2>
        {data?.quarter && <span className="compare-quarter-label">{data.quarter}</span>}
      </div>

      <div className="anomaly-kpi-grid">
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Total Anomalies</div>
          <div className="anomaly-kpi-value mono">{data?.total || 0}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">ROA Anomalies</div>
          <div className="anomaly-kpi-value mono">{data?.roa_anomalies || 0}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">NWR Anomalies</div>
          <div className="anomaly-kpi-value mono">{data?.nwr_anomalies || 0}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Delinquency Anomalies</div>
          <div className="anomaly-kpi-value mono">{data?.delinquency_anomalies || 0}</div>
        </div>
      </div>

      <div className="anomaly-table-wrap">
        <table className="anomaly-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th>Metric</th>
              <th>Current</th>
              <th>Mean</th>
              <th className="sortable" onClick={() => setSortAsc(!sortAsc)}>
                Z-Score {sortAsc ? '\u25B2' : '\u25BC'}
              </th>
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a, idx) => (
              <tr key={`${a.cu_number}-${a.metric_name}-${idx}`}>
                <td>
                  <button
                    type="button"
                    className="pulse-link"
                    onClick={() => onSelectInstitution({
                      cu_number: a.cu_number,
                      name: a.name,
                      state: a.state,
                    })}
                  >
                    {a.name}
                  </button>
                </td>
                <td>{a.state}</td>
                <td>{a.metric_name}</td>
                <td className="mono">{fmtPct(a.current_value)}</td>
                <td className="mono">{fmtPct(a.mean)}</td>
                <td className="mono">{Math.abs(a.z_score).toFixed(1)}</td>
                <td>{directionBadge(a.direction, a.metric_name)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <p className="compare-message">No anomalies detected (all CUs within 2 std dev of their trend).</p>
        )}
      </div>
    </section>
  );
}
