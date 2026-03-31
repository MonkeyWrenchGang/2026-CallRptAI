import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const FRED_SAMPLE = {
  fed_funds: [
    { date: '2020-Q1', value: 1.55 }, { date: '2020-Q2', value: 0.05 },
    { date: '2020-Q3', value: 0.09 }, { date: '2020-Q4', value: 0.09 },
    { date: '2021-Q1', value: 0.07 }, { date: '2021-Q2', value: 0.08 },
    { date: '2021-Q3', value: 0.08 }, { date: '2021-Q4', value: 0.08 },
    { date: '2022-Q1', value: 0.20 }, { date: '2022-Q2', value: 0.77 },
    { date: '2022-Q3', value: 2.56 }, { date: '2022-Q4', value: 3.78 },
    { date: '2023-Q1', value: 4.57 }, { date: '2023-Q2', value: 5.08 },
    { date: '2023-Q3', value: 5.33 }, { date: '2023-Q4', value: 5.33 },
    { date: '2024-Q1', value: 5.33 }, { date: '2024-Q2', value: 5.33 },
    { date: '2024-Q3', value: 5.12 }, { date: '2024-Q4', value: 4.58 },
    { date: '2025-Q1', value: 4.33 }, { date: '2025-Q2', value: 4.33 },
    { date: '2025-Q3', value: 4.08 }, { date: '2025-Q4', value: 3.83 },
  ],
};

function quarterLabelToKey(ql) {
  // "2024-Q3" format — already matches FRED_SAMPLE
  return ql;
}

export default function FredOverlayPanel({ activeCU }) {
  const [fedData, setFedData] = useState(FRED_SAMPLE.fed_funds);
  const [nimData, setNimData] = useState([]);
  const [nimLabel, setNimLabel] = useState('Industry Median NIM');
  const [loading, setLoading] = useState(true);
  const [fredLive, setFredLive] = useState(false);

  // Try to fetch live FRED data, fall back to sample
  useEffect(() => {
    const url = 'https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=DEMO_KEY&file_type=json&observation_start=2020-01-01';
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('FRED unavailable');
        return r.json();
      })
      .then((d) => {
        if (d.observations && d.observations.length > 0) {
          // Group by quarter, take last observation per quarter
          const byQ = {};
          d.observations.forEach((obs) => {
            const dt = new Date(obs.date);
            const q = Math.ceil((dt.getMonth() + 1) / 3);
            const key = `${dt.getFullYear()}-Q${q}`;
            byQ[key] = parseFloat(obs.value);
          });
          const sorted = Object.entries(byQ)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ date, value }));
          if (sorted.length > 4) {
            setFedData(sorted);
            setFredLive(true);
          }
        }
      })
      .catch(() => {
        // Use sample data — already set as default
      });
  }, []);

  // Fetch NIM data — either CU-specific or industry median
  useEffect(() => {
    setLoading(true);
    if (activeCU) {
      fetch(`/api/ncua/institutions/${activeCU}`)
        .then((r) => r.json())
        .then((d) => {
          const trend = d.trend || [];
          const nimPts = trend
            .filter((t) => t.nim != null)
            .map((t) => ({
              date: quarterLabelToKey(t.quarter_label),
              nim: (t.nim * 100),
            }));
          setNimData(nimPts);
          setNimLabel(`CU ${activeCU} NIM`);
          setLoading(false);
        })
        .catch(() => { setNimData([]); setLoading(false); });
    } else {
      // Fetch industry median from pulse market_trend
      fetch('/api/ncua/pulse')
        .then((r) => r.json())
        .then((d) => {
          const trend = d.market_trend || [];
          // NIM may not be in market_trend; use median_roa as proxy or compute NIM if available
          const nimPts = trend.map((t) => ({
            date: quarterLabelToKey(t.quarter_label),
            nim: t.median_nim != null ? (t.median_nim * 100) : (t.median_roa != null ? (t.median_roa * 100 * 4) : null),
          })).filter((p) => p.nim != null);
          setNimData(nimPts);
          setNimLabel('Industry Median NIM (est.)');
          setLoading(false);
        })
        .catch(() => { setNimData([]); setLoading(false); });
    }
  }, [activeCU]);

  // Merge fed funds and NIM into one dataset keyed by quarter
  const merged = (() => {
    const map = {};
    fedData.forEach((p) => { map[p.date] = { date: p.date, fed_funds: p.value }; });
    nimData.forEach((p) => {
      if (map[p.date]) map[p.date].nim = p.nim;
      else map[p.date] = { date: p.date, nim: p.nim };
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  })();

  return (
    <section className="compare-area">
      <div className="compare-header">
        <h2>Rate Environment Overlay</h2>
        <span className="compare-quarter-label">
          {fredLive ? 'Live FRED Data' : 'Sample Data (FRED unavailable)'}
        </span>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Dual-axis chart comparing the Fed Funds Rate with {nimLabel}.
        {activeCU
          ? ' Showing NIM for the selected credit union.'
          : ' Select a CU in the sidebar to see its specific NIM trend.'}
      </p>

      {loading ? (
        <p className="compare-message">Loading overlay data...</p>
      ) : (
        <div style={{ width: '100%', height: 400 }}>
          <ResponsiveContainer>
            <LineChart data={merged} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis
                yAxisId="left"
                label={{ value: 'Fed Funds (%)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                tick={{ fontSize: 11 }}
                domain={[0, 'auto']}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                label={{ value: nimLabel + ' (%)', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
                tick={{ fontSize: 11 }}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                formatter={(val, name) => [`${val?.toFixed(2)}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="fed_funds"
                name="Fed Funds Rate"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="nim"
                name={nimLabel}
                stroke="#1D9E75"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="fred-overlay-notes" style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
        <strong>About this chart:</strong> The left axis shows the effective Federal Funds Rate.
        The right axis shows the Net Interest Margin (NIM). When rates rise quickly, NIM often
        compresses as funding costs catch up to asset yields. A divergence between the two lines
        may indicate margin pressure or effective asset-liability management.
      </div>
    </section>
  );
}
