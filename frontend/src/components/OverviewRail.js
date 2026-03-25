import React, { useEffect, useState } from 'react';
import { fmtAssets, fmtPct, fmtMembers, capitalLabel } from '../utils/format';

const TEAL = '#1D9E75';

function Sparkline({ data, field, width = 160, height = 36 }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => Number(d[field] ?? 0) * 100);
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
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={TEAL}
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

export default function OverviewRail({
  activeCU,
  onAddCompare,
  onOpenCompare,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!activeCU) {
      setData(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
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

  if (!activeCU) return null;

  const inst = data?.institution;
  const latest = data?.latest;
  const trend = data?.trend || [];
  const pcts = data?.percentiles || {};

  const nwrWarn = latest && latest.net_worth_ratio < 0.10;
  const delWarn = latest && latest.delinquency_ratio > 0.02;

  return (
    <aside
      className="overview-rail"
      id="overview-rail-panel"
      aria-labelledby="overview-rail-title"
    >
      <div className="overview-rail-inner">
        {loading && (
          <div className="overview-skeleton" aria-busy="true" aria-live="polite">
            <div className="sk-row" />
            <div className="sk-row" />
            <div className="sk-row short" />
          </div>
        )}

        {error && !loading && (
          <p className="overview-error" role="alert">
            Could not load overview data.
          </p>
        )}

        {!loading && inst && (
          <>
            <h2 id="overview-rail-title" className="overview-title">
              {inst.name}
            </h2>
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
                  <div className="watchlist-flag warn">
                    NWR below 10% — {fmtPct(latest.net_worth_ratio)}
                  </div>
                )}
                {delWarn && (
                  <div className="watchlist-flag warn">
                    Delinquency above 2% — {fmtPct(latest.delinquency_ratio)}
                  </div>
                )}
              </div>
            )}

            {/* Capital classification badge */}
            {latest?.camel_class && (
              <div className="camel-badge">{capitalLabel(latest.camel_class)}</div>
            )}

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

            {/* KPI cards with peer percentile */}
            {latest && (
              <div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-label">ROA</div>
                  <div className="metric-value mono">{fmtPct(latest.roa)}</div>
                  <PercentileBadge value={pcts.roa} />
                </div>
                <div className="metric-card">
                  <div className="metric-label">Net Worth</div>
                  <div className="metric-value mono">{fmtPct(latest.net_worth_ratio)}</div>
                  <PercentileBadge value={pcts.net_worth_ratio} />
                </div>
                <div className="metric-card">
                  <div className="metric-label">Delinquency</div>
                  <div className={`metric-value mono ${delWarn ? 'metric-warn' : ''}`}>
                    {fmtPct(latest.delinquency_ratio)}
                  </div>
                  <PercentileBadge value={pcts.delinquency_ratio} />
                </div>
                <div className="metric-card">
                  <div className="metric-label">Loan/Share</div>
                  <div className="metric-value mono">{fmtPct(latest.loan_to_share_ratio)}</div>
                  <PercentileBadge value={pcts.loan_to_share} />
                </div>
              </div>
            )}

            {/* ROA sparkline */}
            {trend.length >= 2 && (
              <div className="sparkline-section">
                <div className="sparkline-label">ROA trend (8Q)</div>
                <Sparkline data={trend} field="roa" width={220} height={40} />
                <div className="sparkline-axis">
                  <span>{trend[0]?.quarter_label}</span>
                  <span>{trend[trend.length - 1]?.quarter_label}</span>
                </div>
              </div>
            )}

            {/* Peer count note */}
            {pcts.peer_count != null && (
              <p className="peer-hint">
                Percentiles vs {pcts.peer_count} asset-band peers
              </p>
            )}

            {onOpenCompare && (
              <div className="rail-actions">
                <button
                  type="button"
                  className="peer-compare-open-btn"
                  onClick={onOpenCompare}
                >
                  Open Compare
                </button>
                {onAddCompare && (
                  <button
                    type="button"
                    className="peer-add-btn"
                    onClick={() => onAddCompare(activeCU)}
                  >
                    + Add to Compare
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
