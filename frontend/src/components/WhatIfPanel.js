import React, { useState, useEffect } from 'react';
import { fmtAssets, fmtPct } from '../utils/format';

function DeltaCell({ current, projected, label, format }) {
  const fmt = format || fmtPct;
  const delta = projected - current;
  const pctDelta = current !== 0 ? (delta / Math.abs(current)) * 100 : 0;
  const isPos = delta >= 0;
  const colorClass = isPos ? 'whatif-delta-pos' : 'whatif-delta-neg';

  return (
    <div className="whatif-metric-row">
      <div className="whatif-metric-label">{label}</div>
      <div className="whatif-metric-current mono">{fmt(current)}</div>
      <div className="whatif-metric-arrow">&#8594;</div>
      <div className={`whatif-metric-projected mono ${colorClass}`}>{fmt(projected)}</div>
      <div className={`whatif-metric-delta mono ${colorClass}`}>
        {isPos ? '+' : ''}{pctDelta.toFixed(1)}%
      </div>
    </div>
  );
}

export default function WhatIfPanel({ activeCU, onSendChat }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loanGrowth, setLoanGrowth] = useState(0);
  const [shareGrowth, setShareGrowth] = useState(0);
  const [memberGrowth, setMemberGrowth] = useState(0);
  const [incomeChange, setIncomeChange] = useState(0);

  useEffect(() => {
    if (!activeCU) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoanGrowth(0);
    setShareGrowth(0);
    setMemberGrowth(0);
    setIncomeChange(0);
    fetch(`/api/ncua/institutions/${activeCU}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) { setData(d); setLoading(false); }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeCU]);

  if (!activeCU) {
    return (
      <main className="compare-area">
        <header className="compare-header">
          <h2>What-If Scenario</h2>
        </header>
        <p className="compare-message">Select a credit union from the sidebar to model what-if scenarios.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="compare-area">
        <header className="compare-header">
          <h2>What-If Scenario</h2>
        </header>
        <p className="compare-message">Loading data...</p>
      </main>
    );
  }

  const inst = data?.institution;
  const latest = data?.latest;
  if (!inst || !latest) return null;

  const currentLoans = latest.total_loans || 0;
  const currentShares = latest.total_shares || 0;
  const currentAssets = latest.total_assets || 0;
  const currentMembers = latest.member_count || 0;
  const currentNetIncome = latest.net_income || 0;
  const currentEquity = latest.net_worth || latest.total_equity || (currentAssets * (latest.net_worth_ratio || 0.10));

  // Current ratios
  const currentLTS = currentShares !== 0 ? currentLoans / currentShares : 0;
  const currentROA = currentAssets !== 0 ? currentNetIncome / currentAssets : 0;
  const currentNWR = currentAssets !== 0 ? currentEquity / currentAssets : 0;

  // Projected values
  const projLoans = currentLoans * (1 + loanGrowth / 100);
  const projShares = currentShares * (1 + shareGrowth / 100);
  const projMembers = currentMembers * (1 + memberGrowth / 100);
  const projNetIncome = currentNetIncome * (1 + incomeChange / 100);

  // Projected ratios
  const projLTS = projShares !== 0 ? projLoans / projShares : 0;
  const projROA = currentAssets !== 0 ? projNetIncome / currentAssets : 0;
  const projNWR = currentEquity / (currentAssets * (1 + loanGrowth / 100 * 0.5));

  const handleAskClaude = () => {
    if (!onSendChat) return;
    const scenario = `Analyze this what-if scenario for ${inst.name}:
- Loan Growth: ${loanGrowth}%
- Share Growth: ${shareGrowth}%
- Member Growth: ${memberGrowth}%
- Net Income Change: ${incomeChange}%

Current values: Assets ${fmtAssets(currentAssets)}, Loans ${fmtAssets(currentLoans)}, Shares ${fmtAssets(currentShares)}, Members ${currentMembers.toLocaleString()}, Net Income ${fmtAssets(currentNetIncome)}

Projected ratios: Loan-to-Share ${fmtPct(projLTS)}, ROA ${fmtPct(projROA)}, NWR ${fmtPct(projNWR)}

What are the implications and risks of this scenario?`;
    onSendChat(scenario);
  };

  const sliders = [
    { label: 'Loan Growth', value: loanGrowth, setter: setLoanGrowth, min: -20, max: 30 },
    { label: 'Share Growth', value: shareGrowth, setter: setShareGrowth, min: -20, max: 30 },
    { label: 'Member Growth', value: memberGrowth, setter: setMemberGrowth, min: -15, max: 20 },
    { label: 'Net Income Change', value: incomeChange, setter: setIncomeChange, min: -50, max: 50 },
  ];

  return (
    <main className="compare-area">
      <header className="compare-header">
        <h2>What-If Scenario</h2>
        <span className="compare-quarter-label">{inst.name}</span>
      </header>

      {/* Current values */}
      <section className="whatif-current-section">
        <h3 className="whatif-section-title">Current Position</h3>
        <div className="pulse-kpi-grid">
          <div className="pulse-kpi">
            <div className="pulse-kpi-label">Total Assets</div>
            <div className="pulse-kpi-value mono">{fmtAssets(currentAssets)}</div>
          </div>
          <div className="pulse-kpi">
            <div className="pulse-kpi-label">Total Loans</div>
            <div className="pulse-kpi-value mono">{fmtAssets(currentLoans)}</div>
          </div>
          <div className="pulse-kpi">
            <div className="pulse-kpi-label">Total Shares</div>
            <div className="pulse-kpi-value mono">{fmtAssets(currentShares)}</div>
          </div>
          <div className="pulse-kpi">
            <div className="pulse-kpi-label">Members</div>
            <div className="pulse-kpi-value mono">{currentMembers.toLocaleString()}</div>
          </div>
          <div className="pulse-kpi">
            <div className="pulse-kpi-label">Net Income</div>
            <div className="pulse-kpi-value mono">{fmtAssets(currentNetIncome)}</div>
          </div>
        </div>
      </section>

      {/* Sliders */}
      <section className="whatif-sliders-section">
        <h3 className="whatif-section-title">Adjust Assumptions</h3>
        <div className="whatif-sliders">
          {sliders.map((s) => (
            <div key={s.label} className="whatif-slider-row">
              <label className="whatif-slider-label">{s.label}</label>
              <input
                type="range"
                className="whatif-slider"
                min={s.min}
                max={s.max}
                step={0.5}
                value={s.value}
                onChange={(e) => s.setter(Number(e.target.value))}
              />
              <div className="whatif-slider-value-wrap">
                <input
                  type="number"
                  className="whatif-slider-input mono"
                  value={s.value}
                  onChange={(e) => s.setter(Number(e.target.value) || 0)}
                  step={0.5}
                />
                <span className="whatif-slider-pct">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Projected ratios */}
      <section className="whatif-results-section">
        <h3 className="whatif-section-title">Projected Ratios</h3>
        <div className="whatif-results-grid">
          <DeltaCell current={currentLTS} projected={projLTS} label="Loan-to-Share" />
          <DeltaCell current={currentROA} projected={projROA} label="ROA" />
          <DeltaCell current={currentNWR} projected={projNWR} label="Net Worth Ratio" />
        </div>
      </section>

      {/* Ask Claude */}
      <div className="compare-actions">
        <button type="button" className="explain-gaps-btn" onClick={handleAskClaude}>
          Ask Claude to analyze
        </button>
      </div>
    </main>
  );
}
