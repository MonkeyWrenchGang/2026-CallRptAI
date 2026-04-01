import React, { useState, useEffect, useCallback } from 'react';
import { fmtAssets, fmtPct, fmtPctChange, fmtMembers } from '../utils/format';

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

/* ── Mini health gauge for inline pulse ─────────────────────────────── */
function MiniHealthGauge({ score }) {
  const angle = -90 + (score / 100) * 180;
  const color = score >= 75 ? '#059669' : score >= 50 ? '#ef9f27' : '#dc2626';
  const label = score >= 75 ? 'Healthy' : score >= 50 ? 'Moderate' : 'Stressed';
  return (
    <div className="ms-pulse-gauge">
      <svg width="100" height="58" viewBox="0 0 100 58">
        <path d="M 6 52 A 44 44 0 0 1 94 52" fill="none" stroke="#e5e5e5" strokeWidth="8" strokeLinecap="round" />
        <path d="M 6 52 A 44 44 0 0 1 94 52" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 138} 138`} />
        <line x1="50" y1="52" x2={50 + 32 * Math.cos((angle * Math.PI) / 180)} y2={52 + 32 * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="50" cy="52" r="3" fill={color} />
      </svg>
      <div className="ms-pulse-gauge-score mono">{Math.round(score)}</div>
      <div className="ms-pulse-gauge-label" style={{ color }}>{label}</div>
    </div>
  );
}

/* ── Percentile bar for inline pulse ────────────────────────────────── */
function PercentileBar({ value, label, invert = false }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, value));
  const color = invert
    ? (pct >= 60 ? '#059669' : pct >= 30 ? '#ef9f27' : '#dc2626')
    : (pct >= 60 ? '#059669' : pct >= 30 ? '#ef9f27' : '#dc2626');
  return (
    <div className="ms-pulse-pctile">
      <div className="ms-pulse-pctile-label">{label}</div>
      <div className="ms-pulse-pctile-track">
        <div className="ms-pulse-pctile-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="ms-pulse-pctile-val mono">{Math.round(pct)}%ile</div>
    </div>
  );
}

/* ── Sparkline for pulse KPI with threshold lines ──────────────────── */
function PulseKpiSparkline({ data, field, width = 70, height = 20, color = 'var(--teal)', thresholds = [] }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => Number(d[field] ?? 0));
  // Include threshold values in min/max so lines are always visible
  const allVals = [...vals, ...thresholds.map((t) => t.value)];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 0.0001;
  const yFor = (v) => height - ((v - min) / range) * (height - 4) - 2;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    return `${x.toFixed(1)},${yFor(v).toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {thresholds.map((t) => {
        const y = yFor(t.value);
        return (
          <line key={t.label} x1="0" y1={y} x2={width} y2={y}
            stroke={t.color || '#dc2626'} strokeWidth="0.75"
            strokeDasharray={t.dash || '3,2'} opacity="0.7" />
        );
      })}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/* ── QoQ arrow ──────────────────────────────────────────────────────── */
function QoQArrow({ current, previous, invert = false }) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.000001) return <span className="ms-qoq-flat">—</span>;
  const isPositive = invert ? delta < 0 : delta > 0;
  return (
    <span className={`ms-qoq ${isPositive ? 'ms-qoq-up' : 'ms-qoq-down'}`}>
      {isPositive ? '▲' : '▼'} {fmtPctChange(delta)}
    </span>
  );
}

/* ── Inline CU Pulse (expandable row) ───────────────────────────────── */
function CUPulse({ cuNumber }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/ncua/institutions/${cuNumber}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cuNumber]);

  if (loading) return <div className="ms-pulse-loading">Loading pulse…</div>;
  if (!data) return <div className="ms-pulse-loading">Could not load data.</div>;

  const { latest, trend, percentiles } = data;

  // Compute health score (same formula as main Pulse)
  const roa = latest.roa ?? 0;
  const nwr = latest.net_worth_ratio ?? 0;
  const delinq = latest.delinquency_ratio ?? 0;
  let healthScore = 50;
  healthScore += (roa - 0.005) * 3000;
  healthScore += (nwr - 0.08) * 500;
  healthScore -= (delinq - 0.01) * 2000;
  healthScore = Math.max(0, Math.min(100, healthScore));

  // Previous quarter for QoQ
  const prev = trend && trend.length >= 2 ? trend[trend.length - 2] : null;

  const kpis = [
    { label: 'ROA', value: fmtPct(latest.roa, 3), field: 'roa', color: '#1D9E75', prev: prev?.roa, curr: latest.roa,
      thresholds: [
        { value: 0.005, color: '#ef9f27', label: 'Peer avg', dash: '3,2' },
        { value: 0, color: '#dc2626', label: 'Breakeven', dash: '2,2' },
      ] },
    { label: 'Net Worth', value: fmtPct(latest.net_worth_ratio, 2), field: 'net_worth_ratio', color: '#2563eb', prev: prev?.net_worth_ratio, curr: latest.net_worth_ratio,
      thresholds: [
        { value: 0.10, color: '#059669', label: 'Well Cap.', dash: '3,2' },
        { value: 0.07, color: '#dc2626', label: 'Under Cap.', dash: '2,2' },
      ] },
    { label: 'Delinquency', value: fmtPct(latest.delinquency_ratio, 3), field: 'delinquency_ratio', color: '#dc2626', prev: prev?.delinquency_ratio, curr: latest.delinquency_ratio, invert: true,
      thresholds: [
        { value: 0.01, color: '#ef9f27', label: 'Watch', dash: '3,2' },
        { value: 0.02, color: '#dc2626', label: 'Concern', dash: '2,2' },
      ] },
    { label: 'Loan/Share', value: fmtPct(latest.loan_to_share_ratio, 1), field: 'loan_to_share_ratio', color: '#8b5cf6', prev: prev?.loan_to_share_ratio, curr: latest.loan_to_share_ratio,
      thresholds: [
        { value: 0.70, color: '#ef9f27', label: 'Low', dash: '3,2' },
        { value: 0.85, color: '#dc2626', label: 'High', dash: '2,2' },
      ] },
    { label: 'Efficiency', value: fmtPct(latest.efficiency_ratio, 1), field: 'efficiency_ratio', color: '#ef9f27', prev: prev?.efficiency_ratio, curr: latest.efficiency_ratio, invert: true,
      thresholds: [
        { value: 0.75, color: '#ef9f27', label: 'Watch', dash: '3,2' },
        { value: 0.90, color: '#dc2626', label: 'Concern', dash: '2,2' },
      ] },
  ];

  return (
    <div className="ms-pulse-expand">
      <div className="ms-pulse-top">
        <MiniHealthGauge score={healthScore} />
        <div className="ms-pulse-kpis">
          {kpis.map((k) => (
            <div key={k.field} className="ms-pulse-kpi">
              <div className="ms-pulse-kpi-label">{k.label}</div>
              <div className="ms-pulse-kpi-row">
                <span className="ms-pulse-kpi-val mono">{k.value}</span>
                <QoQArrow current={k.curr} previous={k.prev} invert={k.invert} />
              </div>
              <PulseKpiSparkline data={trend} field={k.field} color={k.color} thresholds={k.thresholds} />
              {k.thresholds && (
                <div className="ms-pulse-threshold-legend">
                  {k.thresholds.map((t) => (
                    <span key={t.label} className="ms-pulse-threshold-item">
                      <span className="ms-pulse-threshold-line" style={{ borderColor: t.color }} />
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {percentiles && (
        <div className="ms-pulse-pctiles">
          <div className="ms-pulse-pctiles-header">Peer Percentiles <span className="ms-pulse-peer-count">({percentiles.peer_count} peers)</span></div>
          <PercentileBar value={percentiles.roa} label="ROA" />
          <PercentileBar value={percentiles.net_worth_ratio} label="Net Worth" />
          <PercentileBar value={percentiles.delinquency_ratio} label="Delinquency" />
          <PercentileBar value={percentiles.loan_to_share} label="Loan/Share" />
          <PercentileBar value={percentiles.efficiency_ratio} label="Efficiency" />
        </div>
      )}
      <div className="ms-pulse-meta">
        <span>Assets: <strong className="mono">{fmtAssets(latest.total_assets)}</strong></span>
        <span>Members: <strong className="mono">{fmtMembers(latest.member_count)}</strong></span>
        <span>Quarter: <strong className="mono">{latest.quarter_label}</strong></span>
      </div>
    </div>
  );
}

export default function MarketSharePanel({ activeCU, onSelectInstitution }) {
  const [states, setStates] = useState(null);
  const [selectedState, setSelectedState] = useState('');
  const [metric, setMetric] = useState('total_shares');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(true);
  const [expandedCU, setExpandedCU] = useState(null);

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
                    const isExpanded = expandedCU === r.cu_number;
                    return (
                      <React.Fragment key={r.cu_number}>
                        <tr
                          className={`ms-row-clickable ${isHighlighted ? 'ms-row-highlight' : ''} ${isExpanded ? 'ms-row-expanded' : ''}`}
                          onClick={() => setExpandedCU(isExpanded ? null : r.cu_number)}
                        >
                          <td className="mono">{r.rank}</td>
                          <td>
                            <span className="ms-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                            <button
                              type="button"
                              className="pulse-link"
                              onClick={(e) => { e.stopPropagation(); onSelectInstitution?.({ cu_number: r.cu_number, name: r.name }); }}
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
                        {isExpanded && (
                          <tr className="ms-pulse-row">
                            <td colSpan={8}>
                              <CUPulse cuNumber={r.cu_number} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
