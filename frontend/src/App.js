import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import OverviewRail from './components/OverviewRail';
import ComparePanel from './components/ComparePanel';
import MARadarPanel from './components/MARadarPanel';
import LandscapePanel from './components/LandscapePanel';
import MarketSharePanel from './components/MarketSharePanel';
import FredPanel from './components/FredPanel';
import ReportModal from './components/ReportModal';
import WatchlistPanel from './components/WatchlistPanel';
import WhatIfPanel from './components/WhatIfPanel';
import { useMediaQuery } from './hooks/useMediaQuery';
import { fmtAssets, fmtPct, fmtMembers, fmtPctChange } from './utils/format';
import './App.css';

const INST_SUGGESTIONS = [
  'How are we performing overall?',
  'Show me our profitability trend',
  "What's our asset quality looking like?",
  'How do we compare to peers?',
  'Analyze our capital position',
  'Break down our loan portfolio',
];

const MARKET_SUGGESTIONS = [
  'Give me an overview of top CUs by assets',
  'Which credit unions have the highest ROA?',
  'Who has the highest delinquency rates? Any red flags?',
  'Show me the most efficient institutions',
  'What does industry capital adequacy look like?',
  'Analyze trends in loan-to-share ratios',
];

// ── QoQ arrow helper ──────────────────────────────────────────────────────
function QoQArrow({ current, previous, invert = false, absolute = false }) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.000001) return <span className="qoq-flat">—</span>;
  const isPositive = invert ? delta < 0 : delta > 0;
  // For absolute values (assets, members) compute relative change; ratios are already fractional
  const pctDelta = absolute && previous !== 0 ? delta / previous : delta;
  return (
    <span className={`qoq-arrow ${isPositive ? 'qoq-up' : 'qoq-down'}`}>
      {isPositive ? '▲' : '▼'} {fmtPctChange(pctDelta)}
    </span>
  );
}

// ── Industry distribution bar ────────────────────────────────────────────
function DistributionBar({ dist, label, thresholds }) {
  if (!dist) return null;
  const { p10, p25, p50, p75, p90 } = dist;
  const allVals = [p10, p25, p50, p75, p90].filter((v) => v != null);
  if (allVals.length === 0) return null;
  const min = Math.min(...allVals) * 0.8;
  const max = Math.max(...allVals) * 1.2;
  const range = max - min || 0.001;
  const pos = (v) => `${((v - min) / range) * 100}%`;

  return (
    <div className="dist-bar-section">
      <div className="dist-bar-label">{label}</div>
      <div className="dist-bar-track">
        <div className="dist-bar-iqr" style={{ left: pos(p25), width: `${((p75 - p25) / range) * 100}%` }} />
        <div className="dist-bar-whisker" style={{ left: pos(p10), width: `${((p90 - p10) / range) * 100}%` }} />
        <div className="dist-bar-median" style={{ left: pos(p50) }} />
        {thresholds && thresholds.map((t) => (
          t.value >= min && t.value <= max ? (
            <div key={t.label} className="dist-bar-threshold" style={{ left: pos(t.value) }} title={t.label} />
          ) : null
        ))}
      </div>
      <div className="dist-bar-values">
        <span>P10: {fmtPct(p10)}</span>
        <span>P50: {fmtPct(p50)}</span>
        <span>P90: {fmtPct(p90)}</span>
      </div>
    </div>
  );
}

// ── Mini sparkline for pulse ─────────────────────────────────────────────
function PulseSparkline({ data, field, width = 120, height = 32, color = '#1D9E75' }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => Number(d[field] ?? 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.0001;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Health gauge ─────────────────────────────────────────────────────────
function HealthGauge({ score }) {
  const angle = -90 + (score / 100) * 180;
  const color = score >= 75 ? '#059669' : score >= 50 ? '#ef9f27' : '#dc2626';
  const label = score >= 75 ? 'Healthy' : score >= 50 ? 'Moderate' : 'Stressed';
  return (
    <div className="health-gauge">
      <svg width="160" height="90" viewBox="0 0 160 90">
        <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#e5e5e5" strokeWidth="12" strokeLinecap="round" />
        <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 220} 220`} />
        <line x1="80" y1="80" x2={80 + 50 * Math.cos((angle * Math.PI) / 180)} y2={80 + 50 * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="80" cy="80" r="4" fill={color} />
      </svg>
      <div className="gauge-score mono">{Math.round(score)}</div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

// ── Pulse view ────────────────────────────────────────────────────────────
function PulseView({ onSelectInstitution }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [aiInsight, setAiInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const pulseRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ncua/pulse')
      .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then((d) => { setPulse(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const loadInsight = () => {
    if (aiInsight || insightLoading) return;
    setInsightLoading(true);
    const s = pulse?.summary || {};
    const ps = pulse?.prev_summary || {};
    fetch('/api/ncua/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Analyze what changed this quarter (${s.quarter}) vs last quarter for the credit union industry. Median ROA went from ${((ps.median_roa||0)*100).toFixed(2)}% to ${((s.median_roa||0)*100).toFixed(2)}%. Median NWR from ${((ps.median_nwr||0)*100).toFixed(2)}% to ${((s.median_nwr||0)*100).toFixed(2)}%. Median delinquency from ${((ps.median_delinquency||0)*100).toFixed(2)}% to ${((s.median_delinquency||0)*100).toFixed(2)}%. Total assets ${s.total_assets?.toLocaleString()}. ${s.below_7pct_nwr} CUs below 7% NWR, ${s.below_10pct_nwr} below 10%. ${(pulse?.risk_radar||[]).length} CUs flagged on risk radar. Give a 3-4 sentence executive summary of the most notable shifts and what they mean.`,
        history: [],
      }),
    })
      .then((r) => r.json())
      .then((d) => { setAiInsight(d.answer); setInsightLoading(false); })
      .catch(() => { setAiInsight('Unable to generate insight.'); setInsightLoading(false); });
  };

  const handlePrintPulse = () => {
    const content = pulseRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Market Pulse - ${pulse?.summary?.quarter || ''}</title>
      <style>
        body { font-family: 'IBM Plex Sans', -apple-system, sans-serif; padding: 30px; color: #1a1a18; }
        h2 { font-size: 20px; margin-bottom: 4px; } h3 { font-size: 14px; margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .pulse-kpi-grid { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
        .pulse-kpi { background: #f7f7f5; padding: 10px 14px; border-radius: 8px; min-width: 120px; }
        .pulse-kpi-label { font-size: 10px; color: #6b6a64; text-transform: uppercase; }
        .pulse-kpi-value { font-size: 18px; font-weight: 600; font-family: 'IBM Plex Mono', monospace; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
        th { text-align: left; background: #f7f7f5; padding: 5px 8px; border-bottom: 1px solid #ddd; font-size: 10px; }
        td { padding: 4px 8px; border-bottom: 1px solid #eee; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .text-pos { color: #059669; } .text-neg { color: #dc2626; }
        .pulse-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .qoq-arrow { font-size: 10px; } .qoq-up { color: #059669; } .qoq-down { color: #dc2626; }
        .ai-insight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0; font-size: 13px; }
        .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 10px; color: #9c9a92; }
        @media print { body { padding: 15px; } }
      </style></head><body>${content.innerHTML}
      <div class="footer">CallRpt AI Market Pulse · Generated ${new Date().toLocaleDateString()} · NCUA 5300 Data · Not financial advice</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  if (loading) {
    return (
      <section className="compare-area">
        <div className="compare-header"><h2>Pulse</h2></div>
        <p className="compare-message">Loading market data…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="compare-area">
        <div className="compare-header"><h2>Pulse</h2></div>
        <p className="compare-message error">Could not load pulse data. Is the backend running?</p>
      </section>
    );
  }

  const s = pulse?.summary || {};
  const ps = pulse?.prev_summary || {};
  const movers = pulse?.top_movers || [];
  const radar = pulse?.risk_radar || [];
  const nwrDist = pulse?.nwr_dist || [];
  const dists = pulse?.distributions || {};
  const trend = pulse?.market_trend || [];

  // Compute health score (0-100) from industry medians
  let healthScore = 50;
  if (s.median_roa != null) healthScore += (s.median_roa - 0.005) * 3000; // 0.5% baseline
  if (s.median_nwr != null) healthScore += (s.median_nwr - 0.08) * 500;   // 8% baseline
  if (s.median_delinquency != null) healthScore -= (s.median_delinquency - 0.01) * 2000; // 1% baseline
  healthScore = Math.max(0, Math.min(100, healthScore));

  return (
    <section className="compare-area pulse-view">
      <div className="compare-header">
        <h2>Market Pulse</h2>
        <div className="pulse-header-right">
          {s.quarter && <span className="compare-quarter-label">{s.quarter}</span>}
          <button type="button" className="pulse-print-btn" onClick={handlePrintPulse}>
            Print / PDF
          </button>
        </div>
      </div>

      <div ref={pulseRef}>
        {/* Health gauge + KPIs row */}
        <div className="pulse-top-row">
          <div className="pulse-gauge-wrap">
            <h3>Industry Health</h3>
            <HealthGauge score={healthScore} />
          </div>

          <div className="pulse-kpi-grid">
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Credit Unions</div>
              <div className="pulse-kpi-value mono">{s.cu_count?.toLocaleString() || '—'}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Total Assets</div>
              <div className="pulse-kpi-value mono">{fmtAssets(s.total_assets)}</div>
              <QoQArrow current={s.total_assets} previous={ps.total_assets} absolute />
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Total Members</div>
              <div className="pulse-kpi-value mono">{fmtMembers(s.total_members)}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Median ROA</div>
              <div className="pulse-kpi-value mono">{fmtPct(s.median_roa)}</div>
              <QoQArrow current={s.median_roa} previous={ps.median_roa} />
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Median NWR</div>
              <div className="pulse-kpi-value mono">{fmtPct(s.median_nwr)}</div>
              <QoQArrow current={s.median_nwr} previous={ps.median_nwr} />
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Median Delinquency</div>
              <div className="pulse-kpi-value mono">{fmtPct(s.median_delinquency)}</div>
              <QoQArrow current={s.median_delinquency} previous={ps.median_delinquency} invert />
            </div>
            {s.below_10pct_nwr != null && (
              <div className="pulse-kpi pulse-kpi-warn">
                <div className="pulse-kpi-label">NWR &lt; 10%</div>
                <div className="pulse-kpi-value mono">{s.below_10pct_nwr.toLocaleString()}</div>
              </div>
            )}
            {s.below_7pct_nwr != null && (
              <div className="pulse-kpi pulse-kpi-danger">
                <div className="pulse-kpi-label">NWR &lt; 7%</div>
                <div className="pulse-kpi-value mono">{s.below_7pct_nwr.toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>

        {/* AI "What Changed" insight */}
        <div className="ai-insight-section">
          <div className="ai-insight-header">
            <h3>What Changed This Quarter</h3>
            {!aiInsight && !insightLoading && (
              <button type="button" className="ai-brief-btn" onClick={loadInsight}>Generate</button>
            )}
          </div>
          {insightLoading && <div className="ai-brief-loading">Analyzing quarterly changes...</div>}
          {aiInsight && <div className="ai-insight-text">{aiInsight}</div>}
        </div>

        {/* Industry sparklines */}
        {trend.length >= 2 && (
          <div className="pulse-section">
            <h3>Industry Trends (8 Quarters)</h3>
            <div className="pulse-sparkline-grid">
              {[
                { field: 'median_roa', label: 'Median ROA', color: '#1D9E75', value: s.median_roa },
                { field: 'median_nwr', label: 'Median NWR', color: '#2563eb', value: s.median_nwr },
                { field: 'median_delinquency', label: 'Median Delinquency', color: '#dc2626', value: s.median_delinquency },
              ].map(({ field, label, color, value }) => (
                <div key={field} className="pulse-sparkline-card">
                  <div className="pulse-sparkline-header">
                    <span className="pulse-sparkline-label">{label}</span>
                    <span className="pulse-sparkline-val mono">{fmtPct(value)}</span>
                  </div>
                  <PulseSparkline data={trend} field={field} color={color} />
                  <div className="sparkline-axis">
                    <span>{trend[0]?.quarter_label}</span>
                    <span>{trend[trend.length - 1]?.quarter_label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Industry distribution bars */}
        {Object.keys(dists).length > 0 && (
          <div className="pulse-section">
            <h3>Industry Distribution (Percentiles)</h3>
            <DistributionBar dist={dists.roa} label="ROA" thresholds={[{ label: 'Peer avg', value: 0.008 }]} />
            <DistributionBar dist={dists.nwr} label="Net Worth Ratio" thresholds={[{ label: 'Well Cap.', value: 0.10 }, { label: 'Under Cap.', value: 0.07 }]} />
            <DistributionBar dist={dists.delinquency} label="Delinquency Rate" thresholds={[{ label: 'Watch', value: 0.01 }, { label: 'Concern', value: 0.02 }]} />
            <DistributionBar dist={dists.loan_to_share} label="Loan-to-Share" thresholds={[{ label: 'Low', value: 0.70 }, { label: 'High', value: 0.85 }]} />
          </div>
        )}

        {/* NWR distribution */}
        {nwrDist.length > 0 && (
          <div className="pulse-section">
            <h3>Net Worth Ratio Distribution</h3>
            <div className="nwr-dist">
              {nwrDist.map((band) => (
                <div key={band.band} className="nwr-band">
                  <div className="nwr-band-label">{band.band}</div>
                  <div className="nwr-band-bar-wrap">
                    <div className="nwr-band-bar" style={{ width: `${Math.min(band.pct * 2, 100)}%` }} />
                  </div>
                  <div className="nwr-band-count mono">{band.count.toLocaleString()}</div>
                  <div className="nwr-band-pct mono">({band.pct.toFixed(1)}%)</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pulse-two-col">
          {/* Top movers */}
          {movers.length > 0 && (
            <div className="pulse-section">
              <h3>Top ROA Movers (QoQ)</h3>
              <table className="pulse-table">
                <thead><tr><th>Name</th><th>State</th><th>ROA</th><th>Change</th></tr></thead>
                <tbody>
                  {movers.slice(0, 10).map((m) => (
                    <tr key={m.cu_number}>
                      <td>
                        <button type="button" className="pulse-link"
                          onClick={() => onSelectInstitution({ cu_number: m.cu_number, name: m.name, state: m.state })}>
                          {m.name}
                        </button>
                      </td>
                      <td>{m.state}</td>
                      <td className="mono">{fmtPct(m.roa_curr)}</td>
                      <td className={`mono ${m.roa_delta >= 0 ? 'text-pos' : 'text-neg'}`}>{fmtPctChange(m.roa_delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Risk radar */}
          {radar.length > 0 && (
            <div className="pulse-section">
              <h3>Risk Radar</h3>
              <table className="pulse-table">
                <thead><tr><th>Name</th><th>State</th><th>NWR</th><th>Delinquency</th></tr></thead>
                <tbody>
                  {radar.slice(0, 10).map((r) => (
                    <tr key={r.cu_number}>
                      <td>
                        <button type="button" className="pulse-link"
                          onClick={() => onSelectInstitution({ cu_number: r.cu_number, name: r.name, state: r.state })}>
                          {r.name}
                        </button>
                      </td>
                      <td>{r.state}</td>
                      <td className={`mono ${r.net_worth_ratio < 0.08 ? 'text-neg' : ''}`}>{fmtPct(r.net_worth_ratio)}</td>
                      <td className={`mono ${r.delinquency_ratio > 0.02 ? 'text-neg' : ''}`}>{fmtPct(r.delinquency_ratio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── App root ──────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  const [activeCU, setActiveCU] = useState(null);           // cu_number string
  const [selectedInstitution, setSelectedInstitution] = useState(null); // full inst object
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSqlFor, setShowSqlFor] = useState(null);

  const [overviewDrawerOpen, setOverviewDrawerOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > 900
  );
  const [reportCU, setReportCU] = useState(null); // cu_number for report modal
  const [activeView, setActiveView] = useState('ask');
  const [compareCUs, setCompareCUs] = useState([]); // persistent compare list

  const isNarrow = useMediaQuery('(max-width: 900px)');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Close drawer on Escape (narrow)
  useEffect(() => {
    if (!isNarrow || !overviewDrawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOverviewDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNarrow, overviewDrawerOpen]);

  // Check health / AI status
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setAiEnabled(d.ai_enabled))
      .catch(() => {});
  }, []);

  // Auto-open/close drawer on viewport change
  useEffect(() => {
    if (!isNarrow) {
      setOverviewDrawerOpen(true);
    } else {
      setOverviewDrawerOpen(false);
    }
  }, [isNarrow, activeCU]);

  const sendMessage = async (text) => {
    if (!text.trim()) return;

    const userMsg = { role: 'user', content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/ncua/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          cu_number: activeCU || null,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await response.json();

      // Auto-generate chart config if user asked for a chart but Claude didn't suggest one
      let vizConfig = data.viz_config || null;
      const resultData = data.data || null;
      const wantsChart = /\b(chart|graph|plot|visuali[zs]e)\b/i.test(text);

      if (wantsChart && resultData?.rows?.length > 1 && !vizConfig) {
        const numericCol = resultData.columns.find(
          (c) => typeof resultData.rows[0][c] === 'number'
        );
        const labelCol = resultData.columns.find(
          (c) => typeof resultData.rows[0][c] === 'string'
        );
        if (numericCol && labelCol) {
          vizConfig = {
            chart_type: resultData.rows.length > 8 ? 'line' : 'bar',
            x_field: labelCol,
            y_field: numericCol,
            title: 'Query Results',
          };
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer || data.message || 'No response.',
          citations: data.citations || [],
          sql: data.sql_query,
          source: data.source,
          resultData: resultData,
          vizConfig: vizConfig,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I had trouble connecting to the server. Make sure the backend is running on port 8001.',
          timestamp: new Date(),
        },
      ]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const selectInstitution = (inst) => {
    setSelectedInstitution(inst);
    setActiveCU(inst.cu_number || null);
    setMessages([]);
    setShowSqlFor(null);
    if (isNarrow) setOverviewDrawerOpen(false);
  };

  const clearSelection = () => {
    setSelectedInstitution(null);
    setActiveCU(null);
    setMessages([]);
    setShowSqlFor(null);
  };

  const suggestions = activeCU ? INST_SUGGESTIONS : MARKET_SUGGESTIONS;
  const showRail = !!activeCU;
  const railVisible = !isNarrow || overviewDrawerOpen;

  return (
    <div className="app">
      <header className="app-topbar">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden="true">CR</span>
          <div>
            <span className="topbar-title">CallRpt AI</span>
            <span className="topbar-sub">NCUA 5300 · CU Intelligence</span>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Primary">
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'pulse' ? 'active' : ''}`}
            onClick={() => setActiveView('pulse')}
          >
            Pulse
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'ask' ? 'active' : ''}`}
            onClick={() => setActiveView('ask')}
          >
            Ask
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'compare' ? 'active' : ''}`}
            onClick={() => setActiveView('compare')}
          >
            Compare
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'ma-radar' ? 'active' : ''}`}
            onClick={() => setActiveView('ma-radar')}
          >
            M&A
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'landscape' ? 'active' : ''}`}
            onClick={() => setActiveView('landscape')}
          >
            Landscape
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'market-share' ? 'active' : ''}`}
            onClick={() => setActiveView('market-share')}
          >
            Share
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'fred' ? 'active' : ''}`}
            onClick={() => setActiveView('fred')}
          >
            Macro
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'watchlist' ? 'active' : ''}`}
            onClick={() => setActiveView('watchlist')}
          >
            Watchlist
          </button>
          <button
            type="button"
            className={`topbar-nav-item ${activeView === 'what-if' ? 'active' : ''}`}
            onClick={() => setActiveView('what-if')}
          >
            What-If
          </button>
        </nav>
        <div className="topbar-right">
          <span className={`topbar-pill ${aiEnabled ? 'on' : ''}`}>
            {aiEnabled ? 'Claude AI active' : 'Demo mode'}
          </span>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          sidebarOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          selectedInstitution={selectedInstitution}
          onSelectInstitution={selectInstitution}
          onClearSelection={clearSelection}
          aiEnabled={aiEnabled}
        />

        <div className="main-stack">
          {showRail && isNarrow && overviewDrawerOpen && (
            <button
              type="button"
              className="overview-backdrop"
              aria-label="Close overview"
              onClick={() => setOverviewDrawerOpen(false)}
            />
          )}

          <div className="hybrid-main">
            <div className="view-content">
              {activeView === 'pulse' ? (
                <PulseView onSelectInstitution={selectInstitution} />
              ) : activeView === 'ask' ? (
                <ChatPanel
                  sidebarOpen={sidebarOpen}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  selectedInstitution={selectedInstitution}
                  messages={messages}
                  loading={loading}
                  input={input}
                  onInputChange={setInput}
                  onSend={sendMessage}
                  onKeyDown={handleKeyDown}
                  suggestions={suggestions}
                  showSqlFor={showSqlFor}
                  onToggleSql={setShowSqlFor}
                  inputRef={inputRef}
                  messagesEndRef={messagesEndRef}
                  showOverviewToggle={showRail && isNarrow}
                  overviewOpen={overviewDrawerOpen}
                  onToggleOverview={() => setOverviewDrawerOpen((o) => !o)}
                  onQuickCompare={() => setActiveView('compare')}
                />
              ) : activeView === 'compare' ? (
                <ComparePanel
                  activeCU={activeCU}
                  compareCUs={compareCUs}
                  onCompareCUsChange={setCompareCUs}
                  onSendChat={(text) => {
                    setActiveView('ask');
                    sendMessage(text);
                  }}
                />
              ) : activeView === 'ma-radar' ? (
                <MARadarPanel onSelectInstitution={selectInstitution} />
              ) : activeView === 'landscape' ? (
                <LandscapePanel />
              ) : activeView === 'market-share' ? (
                <MarketSharePanel
                  activeCU={activeCU}
                  onSelectInstitution={selectInstitution}
                />
              ) : activeView === 'fred' ? (
                <FredPanel />
              ) : activeView === 'watchlist' ? (
                <WatchlistPanel onSelectInstitution={selectInstitution} />
              ) : activeView === 'what-if' ? (
                <WhatIfPanel
                  activeCU={activeCU}
                  onSendChat={(text) => {
                    setActiveView('ask');
                    sendMessage(text);
                  }}
                />
              ) : null}
            </div>

            {showRail && (
              <div
                className={`overview-rail-wrap ${railVisible ? 'is-open' : ''} ${isNarrow ? 'is-drawer' : ''}`}
              >
                <OverviewRail
                  activeCU={activeCU}
                  onAddCompare={(cuNum) => {
                    setCompareCUs((prev) =>
                      prev.includes(cuNum) ? prev : [...prev, cuNum].slice(0, 8)
                    );
                    setActiveView('compare');
                  }}
                  onOpenCompare={() => setActiveView('compare')}
                  onComparePeers={(peerNums) => {
                    setCompareCUs((prev) => {
                      const all = [...new Set([activeCU, ...peerNums, ...prev])];
                      return all.slice(0, 8);
                    });
                    setActiveView('compare');
                  }}
                  onGenerateReport={(cuNum) => setReportCU(cuNum)}
                  onAskAbout={(name) => {
                    setActiveView('ask');
                    sendMessage(`Give me an executive overview of ${name}`);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Report generation modal */}
      {reportCU && (
        <ReportModal
          cuNumber={reportCU}
          onClose={() => setReportCU(null)}
        />
      )}
    </div>
  );
}
