import React from 'react';
import { formatAssets, formatPct, formatReportDate } from '../utils/format';

export default function OverviewRail({
  loading,
  error,
  institution,
  latestFinancial,
  peers,
}) {
  if (!institution) return null;

  return (
    <aside
      className="overview-rail"
      id="overview-rail-panel"
      aria-labelledby="overview-rail-title"
    >
      <div className="overview-rail-inner">
        <h2 id="overview-rail-title" className="overview-title">
          {institution.name}
        </h2>
        <p className="overview-sub">
          {institution.institution_type === 'bank' ? 'Bank' : 'Credit union'}
          {' · '}
          {institution.city}, {institution.state}
          {' · '}
          {formatAssets(institution.total_assets_latest)}
          {latestFinancial?.report_date && (
            <>
              {' · '}
              <span className="overview-date">{formatReportDate(latestFinancial.report_date)}</span>
            </>
          )}
        </p>

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

        {!loading && latestFinancial && (
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-label">ROA</div>
              <div className="metric-value">{formatPct(latestFinancial.roa)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">NPL ratio</div>
              <div className="metric-value">{formatPct(latestFinancial.npl_ratio)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Tier 1</div>
              <div className="metric-value">{formatPct(latestFinancial.tier1_capital_ratio)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Efficiency</div>
              <div className="metric-value">{formatPct(latestFinancial.efficiency_ratio)}</div>
            </div>
          </div>
        )}

        {!loading && !latestFinancial && !error && (
          <p className="overview-empty">No financial rows for this institution.</p>
        )}

        {!loading && peers && peers.length > 0 && (
          <>
            <h3 className="peer-heading">Peer snapshot</h3>
            <p className="peer-hint">Similar size, same type (latest quarter)</p>
            <ul className="peer-list">
              {peers.slice(0, 6).map((p) => (
                <li key={p.id} className="peer-row">
                  <span className="peer-name">{p.name}</span>
                  <span className="peer-meta">{p.state}</span>
                  <span className="peer-roa">{formatPct(p.roa)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
