import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fmtPct, fmtAssets, fmtMembers } from '../utils/format';

const GROUPING_OPTIONS = [
  { value: 'asset_band', label: 'Asset Band' },
  { value: 'state', label: 'State' },
  { value: 'charter_type', label: 'Charter Type' },
  { value: 'decade_opened', label: 'Decade Opened' },
];

const TEAL = '#1D9E75';

function healthColor(roa) {
  if (roa == null) return 'var(--text-muted)';
  const v = roa * 100;
  if (v >= 0.8) return '#059669';
  if (v >= 0.4) return '#ef9f27';
  return '#dc2626';
}

export default function CohortPanel() {
  const [groupBy, setGroupBy] = useState('asset_band');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortCol, setSortCol] = useState('group');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/ncua/cohort-analysis?group_by=${groupBy}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load cohort data');
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [groupBy]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const cohorts = data?.cohorts || [];

  const sortedCohorts = [...cohorts].sort((a, b) => {
    let aVal = a[sortCol];
    let bVal = b[sortCol];
    if (typeof aVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    aVal = aVal ?? 0;
    bVal = bVal ?? 0;
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const chartData = cohorts.map((c) => ({
    name: c.group.length > 16 ? c.group.slice(0, 14) + '...' : c.group,
    'Avg ROA': c.avg_roa != null ? +(c.avg_roa * 100).toFixed(3) : 0,
  }));

  const sortArrow = (col) => {
    if (sortCol !== col) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  };

  return (
    <main className="compare-area cohort-panel">
      <header className="compare-header">
        <h2>Cohort Analysis</h2>
        {data?.quarter && <span className="compare-quarter-label">{data.quarter}</span>}
      </header>

      <div className="cohort-controls">
        <label className="rb-option-label" htmlFor="cohort-group-by">Group By</label>
        <select
          id="cohort-group-by"
          className="rb-select"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
        >
          {GROUPING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading && <p className="compare-message">Loading cohort data...</p>}
      {error && <p className="compare-message error">{error}</p>}

      {!loading && cohorts.length > 0 && (
        <>
          {/* Bar chart: Avg ROA by cohort */}
          <section className="cohort-chart-section">
            <h3>Avg ROA by Cohort (%)</h3>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${v.toFixed(3)}%`} />
                  <Bar dataKey="Avg ROA" fill={TEAL} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Sortable table */}
          <section className="compare-table-wrap">
            <div className="compare-table-scroll">
              <table className="compare-table cohort-table">
                <thead>
                  <tr>
                    <th className="sortable-th" onClick={() => handleSort('group')}>
                      Cohort{sortArrow('group')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('count')}>
                      Count{sortArrow('count')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('avg_roa')}>
                      Avg ROA{sortArrow('avg_roa')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('avg_nwr')}>
                      Avg NWR{sortArrow('avg_nwr')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('avg_delinquency')}>
                      Avg Delinq{sortArrow('avg_delinquency')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('avg_efficiency')}>
                      Avg Efficiency{sortArrow('avg_efficiency')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('total_assets')}>
                      Total Assets{sortArrow('total_assets')}
                    </th>
                    <th className="sortable-th" onClick={() => handleSort('total_members')}>
                      Total Members{sortArrow('total_members')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCohorts.map((c) => (
                    <tr key={c.group}>
                      <td className="metric-col-label">{c.group}</td>
                      <td className="mono">{c.count?.toLocaleString()}</td>
                      <td className="mono" style={{ color: healthColor(c.avg_roa) }}>
                        {fmtPct(c.avg_roa)}
                      </td>
                      <td className="mono" style={{ color: healthColor(c.avg_nwr) }}>
                        {fmtPct(c.avg_nwr)}
                      </td>
                      <td className="mono" style={{ color: (c.avg_delinquency ?? 0) > 0.02 ? '#dc2626' : 'inherit' }}>
                        {fmtPct(c.avg_delinquency)}
                      </td>
                      <td className="mono">{fmtPct(c.avg_efficiency)}</td>
                      <td className="mono">{fmtAssets(c.total_assets)}</td>
                      <td className="mono">{fmtMembers(c.total_members)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!loading && !error && cohorts.length === 0 && !data && (
        <p className="compare-message">Select a grouping to analyze cohorts.</p>
      )}
    </main>
  );
}
