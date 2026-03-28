import React, { useEffect, useState } from 'react';
import { fmtAssets, fmtPct, fmtMembers, fmtPctChange, capitalLabel } from '../utils/format';

const TEAL = '#1D9E75';
const TEAL_LIGHT = '#e1f5ee';

function Sparkline({ data, field, width = 200, height = 40, color = TEAL }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => Number(d[field] ?? 0) * (field.includes('ratio') || field === 'roa' || field === 'net_interest_margin' || field === 'efficiency_ratio' ? 100 : 1));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.001;
  const pts = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Area fill
  const areaPath = `M0,${height} L${pts.split(' ').map((p, i) => {
    const [x, y] = p.split(',');
    return i === 0 ? `${x},${y}` : ` L${x},${y}`;
  }).join('')} L${width},${height} Z`;

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <path d={areaPath} fill={color} opacity="0.08" />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PercentileBadge({ value }) {
  if (value == null) return null;
  const pct = Math.round(value);
  let cls = 'pct-badge';
  if (pct >= 70) cls += ' pct-good';
  else if (pct <= 30) cls += ' pct-warn';
  return <span className={cls}>{pct}th pct</span>;
}

function QoQChange({ current, previous }) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  const cls = delta >= 0 ? 'qoq-up' : 'qoq-down';
  return <span className={`qoq-change ${cls}`}>{fmtPctChange(delta)}</span>;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trends', label: 'Trends' },
  { key: 'peers', label: 'Peers' },
];

export default function OverviewRail({
  activeCU,
  onAddCompare,
  onOpenCompare,
  onGenerateReport,
  onAskAbout,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [aiSummary, setAiSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!activeCU) {
      setData(null);
      setError(false);
      setAiSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setAiSummary(null);
    setActiveTab('overview');
    fetch(`/api/ncua/institutions/${activeCU}`)
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      })
      .then((d) => {
        if (!cancelled) { setData(d); setLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setError(true); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [activeCU]);

  const loadAiSummary = () => {
    if (aiSummary || summaryLoading || !data?.institution) return;
    setSummaryLoading(true);
    fetch('/api/ncua/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Give me a 3-sentence executive brief on this credit union's current financial position, highlighting any strengths, risks, or notable trends.`,
        cu_number: activeCU,
        history: [],
      }),
    })
      .then((r) => r.json())
      .then((d) => { setAiSummary(d.answer); setSummaryLoading(false); })
      .catch(() => { setAiSummary('Unable to generate summary.'); setSummaryLoading(false); });
  };

  if (!activeCU) return null;

  const inst = data?.institution;
  const latest = data?.latest;
  const trend = data?.trend || [];
  const pcts = data?.percentiles || {};
  const prevQ = trend.length >= 2 ? trend[1] : null;

  const nwrWarn = latest && latest.net_worth_ratio < 0.10;
  const delWarn = latest && latest.delinquency_ratio > 0.02;

  return (
    <aside className="overview-rail" id="overview-rail-panel" aria-labelledby="overview-rail-title">
      <div className="overview-rail-inner">
        {loading && (
          <div className="overview-skeleton" aria-busy="true" aria-live="polite">
            <div className="sk-row" /><div className="sk-row" /><div className="sk-row short" />
          </div>
        )}

        {error && !loading && (
          <p className="overview-error" role="alert">Could not load overview data.</p>
        )}

        {!loading && inst && (
          <>
            <h2 id="overview-rail-title" className="overview-title">{inst.name}</h2>
            <p className="overview-sub">
              {inst.charter_type || 'Credit Union'}
              {inst.state && <> · {inst.state}</>}
              {inst.year_opened && <> · Est. {inst.year_opened}</>}
              {latest?.quarter_label && <> · {latest.quarter_label}</>}
            </p>

            {/* Watchlist flags */}
            {(nwrWarn || delWarn) && (
              <div className="watchlist-flags">
                {nwrWarn && (
                  <div className="watchlist-flag warn">NWR below 10% — {fmtPct(latest.net_worth_ratio)}</div>
                )}
                {delWarn && (
                  <div className="watchlist-flag warn">Delinquency above 2% — {fmtPct(latest.delinquency_ratio)}</div>
                )}
              </div>
            )}

            {latest?.camel_class && (
              <div className="camel-badge">{capitalLabel(latest.camel_class)}</div>
            )}

            {/* Tab bar */}
            <div className="rail-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`rail-tab ${activeTab === t.key ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(t.key);
                    if (t.key === 'overview' && !aiSummary) loadAiSummary();
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Overview Tab ──────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="rail-tab-content">
                {/* Summary stats */}
                <div className="overview-stats-row">
                  <div className="overview-stat">
                    <div className="overview-stat-label">Total Assets</div>
                    <div className="overview-stat-value mono">{fmtAssets(latest?.total_assets)}</div>
                  </div>
                  <div className="overview-stat">
                    <div className="overview-stat-label">Members</div>
                    <div className="overview-stat-value mono">{fmtMembers(latest?.member_count)}</div>
                  </div>
                  <div className="overview-stat">
                    <div className="overview-stat-label">Net Income</div>
                    <div className="overview-stat-value mono">{fmtAssets(latest?.net_income)}</div>
                  </div>
                </div>

                {/* KPI cards */}
                {latest && (
                  <div className="metric-grid">
                    <div className="metric-card">
                      <div className="metric-label">ROA</div>
                      <div className="metric-value mono">{fmtPct(latest.roa)}</div>
                      <QoQChange current={latest.roa} previous={prevQ?.roa} />
                      <PercentileBadge value={pcts.roa} />
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Net Worth</div>
                      <div className="metric-value mono">{fmtPct(latest.net_worth_ratio)}</div>
                      <QoQChange current={latest.net_worth_ratio} previous={prevQ?.net_worth_ratio} />
                      <PercentileBadge value={pcts.net_worth_ratio} />
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Delinquency</div>
                      <div className={`metric-value mono ${delWarn ? 'metric-warn' : ''}`}>
                        {fmtPct(latest.delinquency_ratio)}
                      </div>
                      <QoQChange current={latest.delinquency_ratio} previous={prevQ?.delinquency_ratio} />
                      <PercentileBadge value={pcts.delinquency_ratio} />
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Loan/Share</div>
                      <div className="metric-value mono">{fmtPct(latest.loan_to_share_ratio)}</div>
                      <QoQChange current={latest.loan_to_share_ratio} previous={prevQ?.loan_to_share_ratio} />
                      <PercentileBadge value={pcts.loan_to_share} />
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">NIM</div>
                      <div className="metric-value mono">{fmtPct(latest.net_interest_margin)}</div>
                      <QoQChange current={latest.net_interest_margin} previous={prevQ?.net_interest_margin} />
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Efficiency</div>
                      <div className={`metric-value mono ${latest.efficiency_ratio > 0.80 ? 'metric-warn' : ''}`}>
                        {fmtPct(latest.efficiency_ratio)}
                      </div>
                      <QoQChange current={latest.efficiency_ratio} previous={prevQ?.efficiency_ratio} />
                    </div>
                  </div>
                )}

                {/* AI Executive Brief */}
                <div className="ai-brief-section">
                  <div className="ai-brief-header">
                    <span className="ai-brief-label">AI Executive Brief</span>
                    {!aiSummary && !summaryLoading && (
                      <button type="button" className="ai-brief-btn" onClick={loadAiSummary}>
                        Generate
                      </button>
                    )}
                  </div>
                  {summaryLoading && <div className="ai-brief-loading">Analyzing...</div>}
                  {aiSummary && <div className="ai-brief-text">{aiSummary}</div>}
                </div>
              </div>
            )}

            {/* ── Trends Tab ───────────────────────────────────────── */}
            {activeTab === 'trends' && (
              <div className="rail-tab-content">
                {trend.length >= 2 ? (
                  <>
                    {[
                      { field: 'roa', label: 'ROA', color: TEAL },
                      { field: 'net_worth_ratio', label: 'Net Worth Ratio', color: '#2563eb' },
                      { field: 'delinquency_ratio', label: 'Delinquency Rate', color: '#dc2626' },
                      { field: 'loan_to_share_ratio', label: 'Loan-to-Share', color: '#9333ea' },
                      { field: 'net_interest_margin', label: 'NIM', color: '#ef9f27' },
                      { field: 'total_assets', label: 'Total Assets', color: '#085041' },
                    ].map(({ field, label, color }) => (
                      <div key={field} className="sparkline-section">
                        <div className="sparkline-header">
                          <span className="sparkline-label">{label}</span>
                          <span className="sparkline-value mono">
                            {field === 'total_assets'
                              ? fmtAssets(latest?.[field])
                              : fmtPct(latest?.[field])}
                          </span>
                        </div>
                        <Sparkline data={trend} field={field} width={220} height={36} color={color} />
                        <div className="sparkline-axis">
                          <span>{trend[0]?.quarter_label}</span>
                          <span>{trend[trend.length - 1]?.quarter_label}</span>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="overview-sub">Not enough data for trends.</p>
                )}
              </div>
            )}

            {/* ── Peers Tab ────────────────────────────────────────── */}
            {activeTab === 'peers' && (
              <div className="rail-tab-content">
                {pcts.peer_count != null ? (
                  <>
                    <p className="peer-hint">
                      Ranked against <strong>{pcts.peer_count}</strong> credit unions in the same asset band
                    </p>
                    <div className="peer-bars">
                      {[
                        { label: 'ROA', value: pcts.roa },
                        { label: 'Net Worth', value: pcts.net_worth_ratio },
                        { label: 'Delinquency', value: pcts.delinquency_ratio, invert: true },
                        { label: 'Loan/Share', value: pcts.loan_to_share },
                      ].filter((p) => p.value != null).map(({ label, value, invert }) => {
                        const pct = Math.round(value);
                        const displayPct = invert ? 100 - pct : pct;
                        let barColor = TEAL;
                        if (displayPct <= 30) barColor = '#dc2626';
                        else if (displayPct <= 50) barColor = '#ef9f27';
                        return (
                          <div key={label} className="peer-bar-row">
                            <span className="peer-bar-label">{label}</span>
                            <div className="peer-bar-track">
                              <div
                                className="peer-bar-fill"
                                style={{ width: `${pct}%`, background: barColor }}
                              />
                              <div className="peer-bar-marker" style={{ left: `${pct}%` }} />
                            </div>
                            <span className="peer-bar-value mono">{pct}th</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="overview-sub">Peer data not available.</p>
                )}

                {onOpenCompare && (
                  <div className="rail-actions">
                    <button type="button" className="rail-action-btn" onClick={onOpenCompare}>
                      Open Compare
                    </button>
                    {onAddCompare && (
                      <button type="button" className="rail-action-btn secondary" onClick={() => onAddCompare(activeCU)}>
                        + Add to Compare
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons — always visible */}
            <div className="rail-action-bar">
              {onAskAbout && (
                <button type="button" className="rail-action-btn" onClick={() => onAskAbout(inst.name)}>
                  Ask about this CU
                </button>
              )}
              {onGenerateReport && (
                <button type="button" className="rail-action-btn primary" onClick={() => onGenerateReport(activeCU)}>
                  Generate Report
                </button>
              )}
            </div>

            {pcts.peer_count != null && activeTab === 'overview' && (
              <p className="peer-hint">Percentiles vs {pcts.peer_count} asset-band peers</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
