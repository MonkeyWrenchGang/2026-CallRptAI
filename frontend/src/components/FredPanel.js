import React, { useState, useEffect } from 'react';

const CATEGORY_LABELS = {
  rates: 'Interest Rates',
  labor: 'Labor Market',
  inflation: 'Inflation',
  credit: 'Consumer Credit',
  growth: 'Economic Growth',
  sentiment: 'Consumer Sentiment',
};

const CATEGORY_ORDER = ['rates', 'labor', 'inflation', 'credit', 'growth', 'sentiment'];

function fmtValue(val, unit) {
  if (val == null) return '—';
  if (unit === '%') return `${val.toFixed(2)}%`;
  if (unit === '$B') return `$${(val / 1).toLocaleString(undefined, { maximumFractionDigits: 1 })}B`;
  if (unit === 'index') return val.toFixed(1);
  return String(val);
}

function changeArrow(change, unit) {
  if (change == null || change === 0) return null;
  const isUp = change > 0;
  const cls = isUp ? 'fred-change-up' : 'fred-change-down';
  const arrow = isUp ? '▲' : '▼';
  const formatted = unit === '%'
    ? `${isUp ? '+' : ''}${change.toFixed(2)}pp`
    : `${isUp ? '+' : ''}${change.toFixed(1)}`;
  return <span className={cls}>{arrow} {formatted}</span>;
}

/* Simple inline SVG sparkline */
function Sparkline({ data, unit, width = 180, height = 40 }) {
  if (!data || data.length < 2) return null;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return `${x},${y}`;
  });

  const last = values[values.length - 1];
  const first = values[0];
  const color = last >= first ? 'var(--teal)' : '#ef4444';

  return (
    <svg width={width} height={height} className="fred-sparkline">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dot on last point */}
      <circle
        cx={(values.length - 1) / (values.length - 1) * width}
        cy={height - 4 - ((last - min) / range) * (height - 8)}
        r="3"
        fill={color}
      />
    </svg>
  );
}

function SeriesCard({ entry, onSelect }) {
  const { label, unit, current, change, trend, series_id } = entry;

  return (
    <button
      type="button"
      className="fred-card"
      onClick={() => onSelect(series_id)}
    >
      <div className="fred-card-header">
        <span className="fred-card-label">{label}</span>
        {changeArrow(change, unit)}
      </div>
      <div className="fred-card-value mono">
        {current ? fmtValue(current.value, unit) : '—'}
      </div>
      {current && (
        <div className="fred-card-date">{current.date}</div>
      )}
      <Sparkline data={trend} unit={unit} />
    </button>
  );
}

/* Expanded detail view for a single series */
function SeriesDetail({ seriesId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/ncua/fred/${seriesId}?limit=60`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [seriesId]);

  if (loading) return <p className="compare-message">Loading {seriesId}...</p>;
  if (!data || !data.observations) return <p className="compare-message">No data available.</p>;

  const obs = data.observations;
  const values = obs.map((o) => o.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const svgW = 600;
  const svgH = 180;

  const points = values.map((v, i) => {
    const x = 40 + (i / (values.length - 1)) * (svgW - 50);
    const y = svgH - 30 - ((v - min) / range) * (svgH - 50);
    return { x, y, v, date: obs[i].date };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Y-axis labels
  const yLabels = [min, min + range * 0.5, max].map((v) => ({
    value: v,
    y: svgH - 30 - ((v - min) / range) * (svgH - 50),
  }));

  // X-axis labels — show ~5 dates
  const step = Math.max(1, Math.floor(obs.length / 5));
  const xLabels = obs.filter((_, i) => i % step === 0).map((o, idx) => ({
    date: o.date.slice(0, 7),
    x: 40 + ((idx * step) / (obs.length - 1)) * (svgW - 50),
  }));

  return (
    <div className="fred-detail">
      <button type="button" className="fred-back-btn" onClick={onBack}>
        ← All Indicators
      </button>
      <h3 className="fred-detail-title">{data.label}</h3>
      <p className="fred-detail-meta">
        {data.category} · {data.unit} · {obs.length} observations
      </p>

      <svg width={svgW} height={svgH} className="fred-detail-chart">
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1="40" y1={yl.y} x2={svgW - 10} y2={yl.y} stroke="var(--border)" strokeDasharray="3,3" />
            <text x="36" y={yl.y + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              {fmtValue(yl.value, data.unit)}
            </text>
          </g>
        ))}
        {/* X labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={svgH - 8} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
            {xl.date}
          </text>
        ))}
        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--teal)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* End dot */}
        {points.length > 0 && (
          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="4" fill="var(--teal)" />
        )}
      </svg>

      {/* Data table */}
      <div className="fred-detail-table-wrap">
        <table className="landscape-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Value</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {obs.slice().reverse().slice(0, 24).map((o, i, arr) => {
              const prev = arr[i + 1];
              const chg = prev ? o.value - prev.value : null;
              return (
                <tr key={o.date}>
                  <td>{o.date}</td>
                  <td className="mono">{fmtValue(o.value, data.unit)}</td>
                  <td className="mono">{changeArrow(chg, data.unit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FredPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeries, setSelectedSeries] = useState(null);

  useEffect(() => {
    fetch('/api/ncua/fred')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (selectedSeries) {
    return (
      <main className="compare-area">
        <SeriesDetail seriesId={selectedSeries} onBack={() => setSelectedSeries(null)} />
      </main>
    );
  }

  return (
    <main className="compare-area">
      <header className="compare-header">
        <h2>Macro Overlay</h2>
        <span className="compare-quarter-label">FRED Economic Data</span>
      </header>

      {loading && <p className="compare-message">Loading macro indicators...</p>}

      {!loading && data && !data.configured && (
        <div className="fred-no-key">
          <p><strong>FRED API key not configured.</strong></p>
          <p>
            Set the <code>FRED_API_KEY</code> environment variable to enable macro data.
            Get a free key at{' '}
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer">
              fred.stlouisfed.org
            </a>.
          </p>
        </div>
      )}

      {!loading && data?.configured && (
        <div className="fred-categories">
          {CATEGORY_ORDER.map((cat) => {
            const entries = data.categories?.[cat];
            if (!entries || entries.length === 0) return null;
            return (
              <section key={cat} className="fred-category">
                <h3 className="fred-category-title">{CATEGORY_LABELS[cat] || cat}</h3>
                <div className="fred-card-grid">
                  {entries.map((entry) => (
                    <SeriesCard key={entry.series_id} entry={entry} onSelect={setSelectedSeries} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
