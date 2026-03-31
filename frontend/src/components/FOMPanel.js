import React, { useState, useEffect } from 'react';

const FOM_TYPES = {
  'Federal': 'Federally chartered credit union regulated directly by NCUA.',
  'State': 'State-chartered credit union regulated by a state agency with NCUA insurance.',
  'FCU': 'Federal Credit Union — community or SEG-based federal charter.',
  'Unknown': 'Charter type not specified in available data.',
};

const CHARTER_DESCRIPTIONS = [
  {
    type: 'Community Charter',
    description: 'Serves everyone within a defined geographic area (county, city, or multi-county region). Open membership to all who live, work, worship, or attend school in the area.',
  },
  {
    type: 'Single SEG (Select Employee Group)',
    description: 'Serves employees of a specific company or organization. Membership limited to employees, retirees, and their families.',
  },
  {
    type: 'Multiple SEG',
    description: 'Serves employees of multiple companies or organizations. Each group is added individually to the charter.',
  },
  {
    type: 'Associational',
    description: 'Serves members of a specific association or group (e.g., military, religious, or professional organizations).',
  },
  {
    type: 'Low-Income Designated (LID)',
    description: 'CUs where a majority of members earn 80% or less of the area median income. Eligible for special programs and secondary capital.',
  },
];

export default function FOMPanel({ activeCU }) {
  const [cuData, setCuData] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeCU) {
      setLoading(true);
      fetch(`/api/ncua/institutions/${activeCU}`)
        .then((r) => r.json())
        .then((d) => {
          setCuData(d.latest || d);
          setLoading(false);
        })
        .catch(() => { setCuData(null); setLoading(false); });
    } else {
      setCuData(null);
    }
  }, [activeCU]);

  // Fetch charter type distribution
  useEffect(() => {
    setLoading(true);
    fetch('/api/ncua/institutions?limit=5000')
      .then((r) => r.json())
      .then((d) => {
        const institutions = d.institutions || d || [];
        const counts = {};
        institutions.forEach((inst) => {
          const ct = inst.charter_type || 'Unknown';
          counts[ct] = (counts[ct] || 0) + 1;
        });
        const total = institutions.length;
        const dist = Object.entries(counts)
          .map(([type, count]) => ({ type, count, pct: total > 0 ? ((count / total) * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count);
        setDistribution({ total, breakdown: dist });
        setLoading(false);
      })
      .catch(() => { setDistribution(null); setLoading(false); });
  }, []);

  return (
    <section className="compare-area">
      <div className="compare-header">
        <h2>Field of Membership & Charter Info</h2>
      </div>

      {loading && <p className="compare-message">Loading data...</p>}

      {/* CU-specific info */}
      {activeCU && cuData && (
        <div className="fom-cu-detail">
          <h3>Selected Credit Union</h3>
          <div className="fom-detail-grid">
            <div className="fom-detail-item">
              <span className="fom-detail-label">Name</span>
              <span className="fom-detail-value">{cuData.name || cuData.cu_name || '--'}</span>
            </div>
            <div className="fom-detail-item">
              <span className="fom-detail-label">CU Number</span>
              <span className="fom-detail-value mono">{activeCU}</span>
            </div>
            <div className="fom-detail-item">
              <span className="fom-detail-label">Charter Type</span>
              <span className="fom-detail-value">{cuData.charter_type || 'Not specified'}</span>
            </div>
            <div className="fom-detail-item">
              <span className="fom-detail-label">State</span>
              <span className="fom-detail-value">{cuData.state || '--'}</span>
            </div>
          </div>
          {cuData.charter_type && FOM_TYPES[cuData.charter_type] && (
            <p className="fom-charter-note">{FOM_TYPES[cuData.charter_type]}</p>
          )}
        </div>
      )}

      {activeCU && !cuData && !loading && (
        <p className="compare-message">Could not load data for CU {activeCU}.</p>
      )}

      {!activeCU && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          No credit union selected. Showing industry-wide charter type distribution.
          Select a CU in the sidebar to see its specific charter and FOM details.
        </p>
      )}

      {/* Distribution summary */}
      {distribution && (
        <div className="fom-distribution">
          <h3>Charter Type Distribution ({distribution.total.toLocaleString()} CUs)</h3>
          <div className="fom-dist-bars">
            {distribution.breakdown.map((b) => (
              <div key={b.type} className="fom-dist-row">
                <span className="fom-dist-label">{b.type}</span>
                <div className="fom-dist-bar-wrap">
                  <div
                    className="fom-dist-bar"
                    style={{ width: `${Math.min(parseFloat(b.pct), 100)}%` }}
                  />
                </div>
                <span className="fom-dist-count mono">{b.count.toLocaleString()}</span>
                <span className="fom-dist-pct mono">({b.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Educational content */}
      <div className="fom-education">
        <h3>Field of Membership Types</h3>
        <div className="fom-types-grid">
          {CHARTER_DESCRIPTIONS.map((cd) => (
            <div key={cd.type} className="fom-type-card">
              <h4 className="fom-type-title">{cd.type}</h4>
              <p className="fom-type-desc">{cd.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
