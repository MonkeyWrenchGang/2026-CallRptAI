import React, { useState, useEffect } from 'react';
import { fmtPct } from '../utils/format';

export default function RegulatoryAlertsPanel({ onSelectInstitution }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ncua/regulatory-alerts')
      .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <section className="compare-area">
        <div className="compare-header"><h2>Regulatory Risk Alerts</h2></div>
        <p className="compare-message">Scanning for regulatory risks...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="compare-area">
        <div className="compare-header"><h2>Regulatory Risk Alerts</h2></div>
        <p className="compare-message error">Could not load alerts. Is the backend running?</p>
      </section>
    );
  }

  const alerts = data?.alerts || [];

  const urgencyClass = (q) => {
    if (q < 2) return 'urgency-red';
    if (q <= 4) return 'urgency-yellow';
    return 'urgency-green';
  };

  const alertTypeBadge = (type) => {
    if (type === 'nwr_approaching') {
      return <span className="anomaly-badge badge-red">NWR Declining</span>;
    }
    return <span className="anomaly-badge badge-amber">Delinquency Rising</span>;
  };

  return (
    <section className="compare-area regulatory-view">
      <div className="compare-header">
        <h2>Regulatory Risk Alerts</h2>
        {data?.quarter && <span className="compare-quarter-label">{data.quarter}</span>}
      </div>

      <div className="anomaly-kpi-grid">
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Total Alerts</div>
          <div className="anomaly-kpi-value mono">{data?.total || 0}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">NWR Alerts</div>
          <div className="anomaly-kpi-value mono">{data?.nwr_alerts || 0}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Delinquency Alerts</div>
          <div className="anomaly-kpi-value mono">{data?.delinquency_alerts || 0}</div>
        </div>
        <div className="anomaly-kpi anomaly-kpi-danger">
          <div className="anomaly-kpi-label">Critical (&lt; 2 Qtrs)</div>
          <div className="anomaly-kpi-value mono">{data?.critical || 0}</div>
        </div>
      </div>

      <div className="anomaly-table-wrap">
        <table className="anomaly-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th>Alert Type</th>
              <th>Current Value</th>
              <th>Trend (per Qtr)</th>
              <th>Qtrs Until Crossing</th>
              <th>Projected Quarter</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a, idx) => (
              <tr key={`${a.cu_number}-${a.alert_type}-${idx}`} className={urgencyClass(a.quarters_until_crossing)}>
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
                <td>{alertTypeBadge(a.alert_type)}</td>
                <td className="mono">{fmtPct(a.current_value)}</td>
                <td className="mono">
                  {a.trend_slope >= 0 ? '+' : ''}{(a.trend_slope * 100).toFixed(3)}%
                </td>
                <td className={`mono ${urgencyClass(a.quarters_until_crossing)}-text`}>
                  {a.quarters_until_crossing.toFixed(1)}
                </td>
                <td className="mono">{a.projected_crossing_quarter}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {alerts.length === 0 && (
          <p className="compare-message">No regulatory risk alerts at this time.</p>
        )}
      </div>
    </section>
  );
}
