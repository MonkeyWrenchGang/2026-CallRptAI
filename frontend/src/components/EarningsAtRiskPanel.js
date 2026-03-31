import React, { useState, useEffect } from 'react';
import { fmtPct } from '../utils/format';

function fmtDollar(val) {
  if (val == null) return '--';
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export default function EarningsAtRiskPanel({ activeCU }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rateChange, setRateChange] = useState(0); // in bps

  useEffect(() => {
    if (!activeCU) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRateChange(0);
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
        <header className="compare-header"><h2>Earnings at Risk</h2></header>
        <p className="compare-message">Select a credit union from the sidebar to model earnings at risk.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="compare-area">
        <header className="compare-header"><h2>Earnings at Risk</h2></header>
        <p className="compare-message">Loading data...</p>
      </main>
    );
  }

  const inst = data?.institution;
  const latest = data?.latest;
  if (!inst || !latest) return null;

  const totalAssets = latest.total_assets || 0;
  const nim = latest.net_interest_margin || 0;
  const currentIntIncome = latest.interest_income || totalAssets * nim * 1.2;
  const currentIntExpense = latest.interest_expense || totalAssets * nim * 0.2;
  const currentNII = latest.net_interest_income || (currentIntIncome - currentIntExpense);
  const currentROA = latest.roa || 0;

  // Rate change as decimal (e.g., 100bps = 0.01)
  const rateDecimal = rateChange / 10000;

  // Simple duration model
  const projectedIncome = currentIntIncome * (1 + rateDecimal * 0.6);
  const projectedExpense = currentIntExpense * (1 + rateDecimal * 0.4);
  const projectedNII = projectedIncome - projectedExpense;
  const niiChange = projectedNII - currentNII;
  const roaImpact = totalAssets > 0 ? niiChange / totalAssets : 0;
  const newROA = currentROA + roaImpact;

  // Bar chart data: NII at each 100bps from -300 to +300
  const barData = [];
  for (let bps = -300; bps <= 300; bps += 100) {
    const rd = bps / 10000;
    const pInc = currentIntIncome * (1 + rd * 0.6);
    const pExp = currentIntExpense * (1 + rd * 0.4);
    barData.push({ bps, nii: pInc - pExp });
  }
  const maxNII = Math.max(...barData.map((d) => d.nii));
  const minNII = Math.min(...barData.map((d) => d.nii));
  const niiRange = maxNII - minNII || 1;

  return (
    <main className="compare-area ear-view">
      <header className="compare-header">
        <h2>Earnings at Risk</h2>
        <span className="compare-quarter-label">{inst.name}</span>
      </header>

      {/* Current metrics */}
      <div className="anomaly-kpi-grid">
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Net Interest Margin</div>
          <div className="anomaly-kpi-value mono">{fmtPct(nim)}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Interest Income</div>
          <div className="anomaly-kpi-value mono">{fmtDollar(currentIntIncome)}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Interest Expense</div>
          <div className="anomaly-kpi-value mono">{fmtDollar(currentIntExpense)}</div>
        </div>
        <div className="anomaly-kpi">
          <div className="anomaly-kpi-label">Net Interest Income</div>
          <div className="anomaly-kpi-value mono">{fmtDollar(currentNII)}</div>
        </div>
      </div>

      {/* Rate change slider */}
      <div className="ear-slider-section">
        <h3>Rate Shock Scenario</h3>
        <div className="ear-slider-row">
          <label className="ear-slider-label">
            Rate Change: <span className="mono ear-slider-val">
              {rateChange >= 0 ? '+' : ''}{rateChange} bps
            </span>
          </label>
          <input
            type="range"
            min={-300}
            max={300}
            step={25}
            value={rateChange}
            onChange={(e) => setRateChange(Number(e.target.value))}
            className="ear-slider"
          />
          <div className="ear-slider-ticks">
            <span>-300</span>
            <span>0</span>
            <span>+300</span>
          </div>
        </div>
      </div>

      {/* Impact results */}
      <div className="ear-results">
        <h3>Projected Impact</h3>
        <div className="ear-results-grid">
          <div className="ear-result-card">
            <div className="ear-result-label">Current NII</div>
            <div className="ear-result-value mono">{fmtDollar(currentNII)}</div>
          </div>
          <div className="ear-result-arrow">&#8594;</div>
          <div className="ear-result-card">
            <div className="ear-result-label">Projected NII</div>
            <div className={`ear-result-value mono ${niiChange >= 0 ? 'text-pos' : 'text-neg'}`}>
              {fmtDollar(projectedNII)}
            </div>
          </div>
          <div className="ear-result-card">
            <div className="ear-result-label">NII Change</div>
            <div className={`ear-result-value mono ${niiChange >= 0 ? 'text-pos' : 'text-neg'}`}>
              {niiChange >= 0 ? '+' : ''}{fmtDollar(niiChange)}
            </div>
          </div>
          <div className="ear-result-card">
            <div className="ear-result-label">ROA Impact</div>
            <div className={`ear-result-value mono ${roaImpact >= 0 ? 'text-pos' : 'text-neg'}`}>
              {roaImpact >= 0 ? '+' : ''}{(roaImpact * 100).toFixed(3)}%
            </div>
          </div>
          <div className="ear-result-card">
            <div className="ear-result-label">New Est. ROA</div>
            <div className={`ear-result-value mono ${newROA >= 0 ? 'text-pos' : 'text-neg'}`}>
              {fmtPct(newROA)}
            </div>
          </div>
        </div>
      </div>

      {/* NII bar chart */}
      <div className="ear-chart-section">
        <h3>Net Interest Income by Rate Scenario</h3>
        <div className="ear-bar-chart">
          {barData.map((d) => {
            const height = ((d.nii - minNII) / niiRange) * 100;
            const isActive = d.bps === Math.round(rateChange / 100) * 100;
            const isNeg = d.nii < currentNII;
            return (
              <div key={d.bps} className={`ear-bar-col ${isActive ? 'ear-bar-active' : ''}`}>
                <div className="ear-bar-value mono">{fmtDollar(d.nii)}</div>
                <div className="ear-bar-track">
                  <div
                    className={`ear-bar ${isNeg ? 'ear-bar-neg' : 'ear-bar-pos'}`}
                    style={{ height: `${Math.max(height, 3)}%` }}
                  />
                </div>
                <div className="ear-bar-label mono">
                  {d.bps >= 0 ? '+' : ''}{d.bps}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
