import React from 'react';
import { formatAssets } from '../utils/format';

export default function Sidebar({
  sidebarOpen,
  onToggle,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilter,
  institutions,
  selectedInstitution,
  onSelectInstitution,
  onClearSelection,
  aiEnabled,
}) {
  return (
    <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`} aria-label="Institutions">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-mark" aria-hidden="true">CR</span>
          <div>
            <h1>CallRpt AI</h1>
            <span className="tagline">Executive Intelligence</span>
          </div>
        </div>
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
                Search institutions
              </label>
              <input
                id="inst-search"
                type="search"
                placeholder="Search institutions..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="filter-row" role="group" aria-label="Institution type">
              <button
                type="button"
                className={`filter-btn ${typeFilter === '' ? 'active' : ''}`}
                onClick={() => onTypeFilter('')}
              >
                All
              </button>
              <button
                type="button"
                className={`filter-btn ${typeFilter === 'bank' ? 'active' : ''}`}
                onClick={() => onTypeFilter('bank')}
              >
                Banks
              </button>
              <button
                type="button"
                className={`filter-btn ${typeFilter === 'credit_union' ? 'active' : ''}`}
                onClick={() => onTypeFilter('credit_union')}
              >
                Credit Unions
              </button>
            </div>
          </div>

          {selectedInstitution && (
            <div className="selected-institution">
              <div className="selected-label">Selected</div>
              <div className="selected-name">{selectedInstitution.name}</div>
              <div className="selected-detail">
                {selectedInstitution.institution_type === 'bank' ? 'Bank' : 'Credit union'}
                {' · '}
                {selectedInstitution.city}, {selectedInstitution.state}
                {' · '}
                {formatAssets(selectedInstitution.total_assets_latest)}
              </div>
              <button type="button" className="clear-btn" onClick={onClearSelection}>
                Clear selection
              </button>
            </div>
          )}

          <div className="institution-list">
            {institutions.map((inst) => (
              <div
                key={inst.id}
                role="button"
                tabIndex={0}
                className={`inst-item ${selectedInstitution?.id === inst.id ? 'selected' : ''}`}
                onClick={() => onSelectInstitution(inst)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectInstitution(inst);
                  }
                }}
              >
                <div className="inst-name">
                  <span className="inst-type-icon" aria-hidden="true">
                    {inst.institution_type === 'bank' ? '🏦' : '🏧'}
                  </span>
                  {inst.name}
                </div>
                <div className="inst-meta">
                  {inst.city}, {inst.state} · {formatAssets(inst.total_assets_latest)}
                </div>
              </div>
            ))}
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
