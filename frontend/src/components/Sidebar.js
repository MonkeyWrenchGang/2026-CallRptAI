import React, { useState, useEffect, useRef } from 'react';
import { fmtAssets } from '../utils/format';

const QUICK_ACCESS = [
  { cu_number: '5536',  name: 'Navy Federal Credit Union',        state: 'VA' },
  { cu_number: '66310', name: "State Employees' Credit Union",    state: 'NC' },
  { cu_number: '227',   name: 'Pentagon Federal Credit Union',    state: 'VA' },
  { cu_number: '62604', name: 'Boeing Employees Credit Union',    state: 'WA' },
  { cu_number: '24212', name: 'SchoolsFirst Federal Credit Union',state: 'CA' },
  { cu_number: '61650', name: 'The Golden 1 Credit Union',        state: 'CA' },
];

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
  const timerRef = useRef(null);

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
  const listItems = showQuick ? QUICK_ACCESS : results;

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

          <div className="institution-list">
            {showQuick && (
              <div className="list-section-label">Quick access</div>
            )}
            {searching && (
              <div className="list-section-label">Searching…</div>
            )}
            {!searching && !showQuick && results.length === 0 && query.trim() && (
              <div className="list-section-label">No results</div>
            )}
            {listItems.map((inst) => {
              const key = inst.cu_number || inst.id;
              const isSelected = selectedInstitution?.cu_number === inst.cu_number ||
                                 selectedInstitution?.id === inst.id;
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
                  <div className="inst-meta">
                    {inst.state}
                    {inst.total_assets != null && <> · {fmtAssets(inst.total_assets)}</>}
                  </div>
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
