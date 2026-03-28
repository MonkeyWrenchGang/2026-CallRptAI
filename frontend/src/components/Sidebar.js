import React, { useState, useEffect, useRef } from 'react';
import { fmtAssets, fmtMembers, fmtRatio, fmtPct } from '../utils/format';

const QUICK_CU_NUMBERS = ['5536', '66310', '227', '62604', '24212', '61650'];

export default function Sidebar({
  sidebarOpen,
  onToggle,
  selectedInstitution,
  onSelectInstitution,
  onClearSelection,
  aiEnabled,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [quickData, setQuickData] = useState([]);
  const [sidebarPeers, setSidebarPeers] = useState([]);
  const timerRef = useRef(null);

  // Fetch quick access data on mount
  useEffect(() => {
    fetch(`/api/ncua/quick-access?cu_numbers=${QUICK_CU_NUMBERS.join(',')}`)
      .then((r) => r.json())
      .then((d) => setQuickData(d.results || []))
      .catch(() => setQuickData([]));
  }, []);

  // Fetch peers when a CU is selected
  useEffect(() => {
    if (!selectedInstitution?.cu_number) {
      setSidebarPeers([]);
      return;
    }
    fetch(`/api/ncua/institutions/${selectedInstitution.cu_number}/peers`)
      .then((r) => r.json())
      .then((d) => setSidebarPeers((d.peers || []).slice(0, 5)))
      .catch(() => setSidebarPeers([]));
  }, [selectedInstitution?.cu_number]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch(`/api/ncua/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          setResults(Array.isArray(d) ? d : (d.results || []));
          setSearching(false);
        })
        .catch(() => {
          setResults([]);
          setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const handleSelect = (inst) => {
    onSelectInstitution(inst);
    setQuery('');
    setResults([]);
  };

  const showQuick = !query.trim();
  const listItems = showQuick ? quickData : results;

  return (
    <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`} aria-label="Institutions">
      <div className="sidebar-header">
        {sidebarOpen && <span className="sidebar-header-label">Institutions</span>}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggle}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </div>

      {sidebarOpen && (
        <>
          <div className="sidebar-section">
            <div className="search-box">
              <label htmlFor="inst-search" className="visually-hidden">
                Search credit unions
              </label>
              <input
                id="inst-search"
                type="search"
                placeholder="Search credit unions..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          {selectedInstitution && (
            <div className="selected-institution">
              <div className="selected-name">{selectedInstitution.name}</div>
              <div className="selected-detail">
                {selectedInstitution.state}
                {selectedInstitution.total_assets != null && (
                  <> · {fmtAssets(selectedInstitution.total_assets)}</>
                )}
              </div>
              <button type="button" className="clear-btn" onClick={onClearSelection}>
                ✕ Clear
              </button>
            </div>
          )}

          {/* Peer CUs when selected */}
          {selectedInstitution && sidebarPeers.length > 0 && showQuick && (
            <div className="institution-list sidebar-peers">
              <div className="list-section-label">Similar Credit Unions</div>
              {sidebarPeers.map((p) => (
                <div
                  key={p.cu_number}
                  role="button"
                  tabIndex={0}
                  className="inst-item"
                  onClick={() => handleSelect(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(p);
                    }
                  }}
                >
                  <div className="inst-name">{p.name}</div>
                  <div className="inst-metrics">
                    <span className="inst-metric">{fmtAssets(p.total_assets)}</span>
                    {p.roa != null && (
                      <span className="inst-metric">ROA {fmtPct(p.roa)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="institution-list">
            {showQuick && !selectedInstitution && (
              <div className="list-section-label">Quick access</div>
            )}
            {searching && (
              <div className="list-section-label">Searching…</div>
            )}
            {!searching && !showQuick && results.length === 0 && query.trim() && (
              <div className="list-section-label">No results</div>
            )}
            {(showQuick && selectedInstitution ? [] : listItems).map((inst) => {
              const key = inst.cu_number || inst.id;
              const isSelected = selectedInstitution?.cu_number === inst.cu_number ||
                                 selectedInstitution?.id === inst.id;
              const hasMetrics = inst.total_assets != null;
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  className={`inst-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelect(inst)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(inst);
                    }
                  }}
                >
                  <div className="inst-name">{inst.name}</div>
                  {hasMetrics ? (
                    <div className="inst-metrics">
                      <span className="inst-metric">{fmtAssets(inst.total_assets)}</span>
                      {inst.member_count != null && (
                        <span className="inst-metric">{fmtMembers(inst.member_count)} mbrs</span>
                      )}
                      {inst.net_worth_ratio != null && (
                        <span className="inst-metric">NW {fmtRatio(inst.net_worth_ratio)}</span>
                      )}
                    </div>
                  ) : (
                    <div className="inst-meta">{inst.state}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sidebar-footer">
            <div className={`status-dot ${aiEnabled ? 'ai-on' : 'ai-off'}`} aria-hidden="true" />
            <span>{aiEnabled ? 'Claude AI active' : 'Demo mode (add API key)'}</span>
          </div>
        </>
      )}
    </aside>
  );
}
