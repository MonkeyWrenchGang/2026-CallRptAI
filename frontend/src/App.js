import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import OverviewRail from './components/OverviewRail';
import ComparePanel from './components/ComparePanel';
import ReportModal from './components/ReportModal';
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

// ── Pulse view ────────────────────────────────────────────────────────────
function PulseView({ onSelectInstitution }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ncua/pulse')
      .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then((d) => { setPulse(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

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
  const movers = pulse?.top_movers || [];
  const radar = pulse?.risk_radar || [];
  const nwrDist = pulse?.nwr_dist || [];

  return (
    <section className="compare-area pulse-view">
      <div className="compare-header">
        <h2>Market Pulse</h2>
        {s.quarter && <span className="compare-quarter-label">{s.quarter}</span>}
      </div>

      {/* Summary KPIs */}
      <div className="pulse-kpi-grid">
        <div className="pulse-kpi">
          <div className="pulse-kpi-label">Credit Unions</div>
          <div className="pulse-kpi-value mono">{s.cu_count?.toLocaleString() || '—'}</div>
        </div>
        <div className="pulse-kpi">
          <div className="pulse-kpi-label">Total Assets</div>
          <div className="pulse-kpi-value mono">{fmtAssets(s.total_assets)}</div>
        </div>
        <div className="pulse-kpi">
          <div className="pulse-kpi-label">Total Members</div>
          <div className="pulse-kpi-value mono">{fmtMembers(s.total_members)}</div>
        </div>
        <div className="pulse-kpi">
          <div className="pulse-kpi-label">Median ROA</div>
          <div className="pulse-kpi-value mono">{fmtPct(s.median_roa)}</div>
        </div>
        <div className="pulse-kpi">
          <div className="pulse-kpi-label">Median NWR</div>
          <div className="pulse-kpi-value mono">{fmtPct(s.median_nwr)}</div>
        </div>
        <div className="pulse-kpi">
          <div className="pulse-kpi-label">Median Delinquency</div>
          <div className="pulse-kpi-value mono">{fmtPct(s.median_delinquency)}</div>
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

      {/* NWR distribution */}
      {nwrDist.length > 0 && (
        <div className="pulse-section">
          <h3>Net Worth Ratio Distribution</h3>
          <div className="nwr-dist">
            {nwrDist.map((band) => (
              <div key={band.band} className="nwr-band">
                <div className="nwr-band-label">{band.band}</div>
                <div className="nwr-band-bar-wrap">
                  <div
                    className="nwr-band-bar"
                    style={{ width: `${Math.min(band.pct * 2, 100)}%` }}
                  />
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
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>ROA</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {movers.slice(0, 10).map((m) => (
                  <tr key={m.cu_number}>
                    <td>
                      <button
                        type="button"
                        className="pulse-link"
                        onClick={() => onSelectInstitution({ cu_number: m.cu_number, name: m.name, state: m.state })}
                      >
                        {m.name}
                      </button>
                    </td>
                    <td>{m.state}</td>
                    <td className="mono">{fmtPct(m.roa_curr)}</td>
                    <td className={`mono ${m.roa_delta >= 0 ? 'text-pos' : 'text-neg'}`}>
                      {fmtPctChange(m.roa_delta)}
                    </td>
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
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>NWR</th>
                  <th>Delinquency</th>
                </tr>
              </thead>
              <tbody>
                {radar.slice(0, 10).map((r) => (
                  <tr key={r.cu_number}>
                    <td>
                      <button
                        type="button"
                        className="pulse-link"
                        onClick={() => onSelectInstitution({ cu_number: r.cu_number, name: r.name, state: r.state })}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td>{r.state}</td>
                    <td className={`mono ${r.net_worth_ratio < 0.08 ? 'text-neg' : ''}`}>
                      {fmtPct(r.net_worth_ratio)}
                    </td>
                    <td className={`mono ${r.delinquency_ratio > 0.02 ? 'text-neg' : ''}`}>
                      {fmtPct(r.delinquency_ratio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
              ) : (
                <ComparePanel
                  activeCU={activeCU}
                  compareCUs={compareCUs}
                  onCompareCUsChange={setCompareCUs}
                  onSendChat={(text) => {
                    setActiveView('ask');
                    sendMessage(text);
                  }}
                />
              )}
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
