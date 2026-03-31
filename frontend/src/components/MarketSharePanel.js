import React, { useState, useEffect, useCallback } from 'react';
import { fmtAssets, fmtPct, fmtMembers } from '../utils/format';

const METRICS = [
  { key: 'total_shares', label: 'Deposits' },
  { key: 'total_loans', label: 'Loans' },
  { key: 'member_count', label: 'Members' },
];

function ShareBar({ share, maxShare, color = 'var(--teal)' }) {
  const pct = maxShare > 0 ? (share / maxShare) * 100 : 0;
  return (
    <div className="ms-bar-wrap">
      <div className="ms-bar" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function TrendSparkline({ data, width = 110, height = 28, color = 'var(--teal)' }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => d.share ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.00001;
  const pts = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ConcentrationGauge({ hhi }) {
  // HHI: 0-10000 scale. <1000 = competitive, 1000-1800 = moderate, >1800 = concentrated
  const label = hhi < 1000 ? 'Competitive' : hhi < 1800 ? 'Moderate' : 'Concentrated';
  const color = hhi < 1000 ? '#059669' : hhi < 1800 ? '#ef9f27' : '#dc2626';
  const pct = Math.min(hhi / 3000, 1) * 100;
  return (
    <div className="ms-hhi-gauge">
      <div className="ms-hhi-track">
        <div className="ms-hhi-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="ms-hhi-labels">
        <span className="mono" style={{ color, fontWeight: 600 }}>{hhi.toLocaleString()}</span>
        <span className="ms-hhi-desc">{label}</span>
      </div>
    </div>
  );
}

function fmtMetricValue(val, metric) {
  if (val == null) return '—';
  if (metric === 'member_count') return fmtMembers(val);
  return fmtAssets(val);
}

export default function MarketSharePanel({ activeCU, onSelectInstitution }) {
  const [states, setStates] = useState(null);
  const [selectedState, setSelectedState] = useState('');
  const [metric, setMetric] = useState('total_shares');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(true);

  // Fetch states list on mount
  useEffect(() => {
    fetch('/api/ncua/market-share-analysis')
      .then((r) => r.json())
      .then((d) => {
        setStates(d.states || []);
        setStatesLoading(false);
      })
      .catch(() => setStatesLoading(false));
  }, []);

  const fetchData = useCallback(() => {
    if (!selectedState) return;
    setLoading(true);
    const cuParam = activeCU ? `&cu_number=${activeCU}` : '';
    fetch(`/api/ncua/market-share-analysis?state=${selectedState}&metric=${metric}${cuParam}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedState, metric, activeCU]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rankings = data?.rankings || [];
  const concentration = data?.concentration || {};
  const highlight = data?.highlight;
  const stateTrend = data?.state_trend || [];
  const cuTrends = data?.cu_trends || {};
  const maxShare = rankings.length > 0 ? rankings[0].share : 0;

  return (
    <main className="compare-area ms-panel">
      <header className="compare-header">
        <h2>Market Share Analysis</h2>
        {data?.quarter && <span className="compare-quarter-label">{data.quarter}</span>}
      </header>

      {/* Controls */}
      <div className="ms-controls">
        <div className="ms-control-group">
          <label htmlFor="ms-state-select">State</label>
          <select
            id="ms-state-select"
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            disabled={statesLoading}
          >
            <option value="">Select a state…</option>
            {(states || []).map((s) => (
              <option key={s.state} value={s.state}>
                {s.state} ({s.cu_count} CUs)
              </option>
            ))}
          </select>
        </div>
        <div className="ms-control-group">
          <label>Metric</label>
          <div className="ms-metric-tabs">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`ms-metric-tab ${metric === m.key ? 'active' : ''}`}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!selectedState && !loading && (
        <p className="compare-message">Select a state to view market share analysis.</p>
      )}

      {loading && <p className="compare-message">Loading market share data…</p>}

      {data && !loading && (
        <>
          {/* KPIs row */}
          <div className="pulse-kpi-grid" style={{ marginBottom: 16 }}>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Credit Unions</div>
              <div className="pulse-kpi-value mono">{concentration.total_cus?.toLocaleString() || '—'}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Top 5 Share</div>
              <div className="pulse-kpi-value mono">{fmtPct(concentration.top5_share)}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Top 10 Share</div>
              <div className="pulse-kpi-value mono">{fmtPct(concentration.top10_share)}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">HHI Concentration</div>
              <ConcentrationGauge hhi={concentration.hhi || 0} />
            </div>
          </div>

          {/* State totals trend */}
          {stateTrend.length >= 2 && (
            <div className="ms-state-trend">
              <h3>State {data.metric_label} Over Time</h3>
              <div className="ms-trend-chart">
                {stateTrend.map((q, i) => {
                  const metricKey = metric === 'total_shares' ? 'total_deposits' : metric === 'total_loans' ? 'total_loans' : 'total_members';
                  const val = q[metricKey] || 0;
                  const maxVal = Math.max(...stateTrend.map((t) => t[metricKey] || 0));
                  const barH = maxVal > 0 ? (val / maxVal) * 100 : 0;
                  return (
                    <div key={q.quarter_label} className="ms-trend-bar-col">
                      <div className="ms-trend-bar-val mono">{fmtMetricValue(val, metric)}</div>
                      <div className="ms-trend-bar-track">
                        <div className="ms-trend-bar-fill" style={{ height: `${barH}%` }} />
                      </div>
                      <div className="ms-trend-bar-label">{q.quarter_label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Highlighted CU callout */}
          {highlight && (
            <div className="ms-highlight">
              <div className="ms-highlight-header">
                <span className="ms-highlight-name">{highlight.name}</span>
                <span className="ms-highlight-rank">#{highlight.rank} in {selectedState}</span>
              </div>
              <div className="ms-highlight-stats">
                <div className="ms-highlight-stat">
                  <span className="ms-highlight-label">{data.metric_label}</span>
                  <span className="mono">{fmtMetricValue(highlight.value, metric)}</span>
                </div>
                <div className="ms-highlight-stat">
                  <span className="ms-highlight-label">Market Share</span>
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--teal-dark)' }}>
                    {fmtPct(highlight.share, 3)}
                  </span>
                </div>
                <div className="ms-highlight-stat">
                  <span className="ms-highlight-label">Total Assets</span>
                  <span className="mono">{fmtAssets(highlight.total_assets)}</span>
                </div>
              </div>
              {highlight.trend && highlight.trend.length >= 2 && (
                <div className="ms-highlight-trend">
                  <span className="ms-highlight-label">Share Trend</span>
                  <TrendSparkline data={highlight.trend} width={160} height={32} />
                  <div className="ms-highlight-trend-range">
                    <span className="mono">{fmtPct(highlight.trend[0]?.share, 3)}</span>
                    <span className="mono">{fmtPct(highlight.trend[highlight.trend.length - 1]?.share, 3)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rankings table */}
          {rankings.length > 0 && (
            <div className="ms-rankings">
              <h3>Top {rankings.length} by {data.metric_label} — {selectedState}</h3>
              <table className="ms-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>City</th>
                    <th>{data.metric_label}</th>
                    <th>Share</th>
                    <th style={{ width: '20%' }}></th>
                    <th>Trend</th>
                    <th>Assets</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((r) => {
                    const isHighlighted = highlight && r.cu_number === highlight.cu_number;
                    return (
                      <tr key={r.cu_number} className={isHighlighted ? 'ms-row-highlight' : ''}>
                        <td className="mono">{r.rank}</td>
                        <td>
                          <button
                            type="button"
                            className="pulse-link"
                            onClick={() => onSelectInstitution?.({
                              cu_number: r.cu_number,
                              name: r.name,
                            })}
                          >
                            {r.name}
                          </button>
                        </td>
                        <td className="ms-city">{r.city}</td>
                        <td className="mono">{fmtMetricValue(r.value, metric)}</td>
                        <td className="mono" style={{ fontWeight: 600 }}>{fmtPct(r.share, 2)}</td>
                        <td>
                          <ShareBar share={r.share} maxShare={maxShare} />
                        </td>
                        <td>
                          <TrendSparkline
                            data={cuTrends[r.cu_number]}
                            width={80}
                            height={24}
                          />
                        </td>
                        <td className="mono">{fmtAssets(r.total_assets)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
