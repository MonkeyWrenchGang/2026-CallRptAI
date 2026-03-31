import React, { useState, useEffect } from 'react';

export default function CFPBPanel({ activeCU, selectedInstitution }) {
  const [complaints, setComplaints] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchName, setSearchName] = useState('');

  const cuName = selectedInstitution?.name || null;

  useEffect(() => {
    if (!activeCU) { setComplaints(null); return; }
    setLoading(true);
    setError(null);
    fetch(`/api/ncua/cfpb-complaints/${activeCU}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch');
        return r.json();
      })
      .then((d) => {
        setComplaints(d);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not retrieve complaint data. The CFPB API may be unavailable.');
        setLoading(false);
      });
  }, [activeCU]);

  const handleSearch = () => {
    if (!searchName.trim()) return;
    setLoading(true);
    setError(null);
    // Search by name via a query param
    fetch(`/api/ncua/cfpb-complaints/search?company=${encodeURIComponent(searchName.trim())}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        return r.json();
      })
      .then((d) => { setComplaints(d); setLoading(false); })
      .catch(() => {
        setError('Search failed. The CFPB API may be unavailable.');
        setLoading(false);
      });
  };

  const topProducts = complaints?.top_products || [];
  const topIssues = complaints?.top_issues || [];
  const recentList = complaints?.recent || [];

  return (
    <section className="compare-area">
      <div className="compare-header">
        <h2>CFPB Consumer Complaints</h2>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Consumer complaint data from the CFPB public database.
        {activeCU && cuName ? ` Showing results for ${cuName}.` : ' Select a CU or search by name below.'}
      </p>

      {/* Search box when no CU selected */}
      {!activeCU && (
        <div className="cfpb-search-box">
          <input
            type="text"
            className="cfpb-search-input"
            placeholder="Search by credit union name..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button type="button" className="cfpb-search-btn" onClick={handleSearch}>
            Search
          </button>
        </div>
      )}

      {loading && <p className="compare-message">Loading complaint data...</p>}
      {error && <p className="compare-message" style={{ color: '#dc2626' }}>{error}</p>}

      {complaints && !loading && (
        <div className="cfpb-results">
          {/* Summary */}
          <div className="cfpb-summary-row">
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Total Complaints</div>
              <div className="pulse-kpi-value mono">{complaints.total_complaints?.toLocaleString() || 0}</div>
            </div>
            <div className="pulse-kpi">
              <div className="pulse-kpi-label">Company</div>
              <div className="pulse-kpi-value" style={{ fontSize: 14 }}>{complaints.company_name || '--'}</div>
            </div>
            {complaints.timely_response_pct != null && (
              <div className="pulse-kpi">
                <div className="pulse-kpi-label">Timely Response</div>
                <div className="pulse-kpi-value mono">{complaints.timely_response_pct}%</div>
              </div>
            )}
          </div>

          {complaints.total_complaints === 0 && (
            <div className="cfpb-no-data">
              <p>No complaints found for this institution. This is a positive indicator --
                 either the institution has no CFPB complaints on record, or it may be listed
                 under a different name in the CFPB database.</p>
            </div>
          )}

          {/* Top complaint products */}
          {topProducts.length > 0 && (
            <div className="cfpb-section">
              <h3>Top Complaint Products</h3>
              <div className="cfpb-bar-list">
                {topProducts.map((p, i) => (
                  <div key={i} className="cfpb-bar-row">
                    <span className="cfpb-bar-label">{p.product}</span>
                    <div className="cfpb-bar-wrap">
                      <div
                        className="cfpb-bar"
                        style={{ width: `${topProducts[0]?.count ? (p.count / topProducts[0].count) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="cfpb-bar-count mono">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top issues */}
          {topIssues.length > 0 && (
            <div className="cfpb-section">
              <h3>Top Issues</h3>
              <div className="cfpb-bar-list">
                {topIssues.map((iss, i) => (
                  <div key={i} className="cfpb-bar-row">
                    <span className="cfpb-bar-label">{iss.issue}</span>
                    <div className="cfpb-bar-wrap">
                      <div
                        className="cfpb-bar cfpb-bar-issue"
                        style={{ width: `${topIssues[0]?.count ? (iss.count / topIssues[0].count) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="cfpb-bar-count mono">{iss.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent complaints */}
          {recentList.length > 0 && (
            <div className="cfpb-section">
              <h3>Recent Complaints</h3>
              <table className="pulse-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Issue</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentList.slice(0, 10).map((c, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: 11 }}>{c.date_received || '--'}</td>
                      <td>{c.product || '--'}</td>
                      <td>{c.issue || '--'}</td>
                      <td>{c.company_response || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {complaints.note && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12, fontStyle: 'italic' }}>
              {complaints.note}
            </p>
          )}
        </div>
      )}

      {!complaints && !loading && !error && !activeCU && (
        <div className="cfpb-no-data">
          <p>Search for a credit union above or select one from the sidebar to view complaint data.</p>
        </div>
      )}
    </section>
  );
}
