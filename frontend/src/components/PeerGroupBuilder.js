import React, { useState, useEffect } from 'react';
import { fmtAssets, fmtPct } from '../utils/format';

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX',
  'UT','VT','VA','WA','WV','WI','WY',
];

const STORAGE_KEY = 'callrptai_saved_peer_groups';

function loadSavedGroups() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveGroups(groups) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

export default function PeerGroupBuilder({ onLoadGroup }) {
  const [state, setState] = useState('');
  const [charterType, setCharterType] = useState('');
  const [minAssets, setMinAssets] = useState('');
  const [maxAssets, setMaxAssets] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [savedGroups, setSavedGroups] = useState(loadSavedGroups);

  const handlePreview = () => {
    setPreviewLoading(true);
    const params = new URLSearchParams();
    if (state) params.append('state', state);
    if (charterType) params.append('charter_type', charterType);
    if (minAssets) params.append('min_assets', String(Number(minAssets) * 1e6));
    if (maxAssets) params.append('max_assets', String(Number(maxAssets) * 1e6));

    fetch(`/api/ncua/peer-group-stats?${params}`)
      .then((r) => r.json())
      .then((d) => { setPreview(d); setPreviewLoading(false); })
      .catch(() => setPreviewLoading(false));
  };

  const handleSave = () => {
    if (!groupName.trim() || !preview) return;
    const group = {
      name: groupName.trim(),
      filters: { state, charterType, minAssets, maxAssets },
      cu_numbers: preview.cu_numbers || [],
      count: preview.count,
      savedAt: new Date().toISOString(),
    };
    const updated = [group, ...savedGroups.filter((g) => g.name !== group.name)].slice(0, 10);
    saveGroups(updated);
    setSavedGroups(updated);
    setGroupName('');
  };

  const handleLoadGroup = (group) => {
    if (onLoadGroup) {
      onLoadGroup(group.cu_numbers.slice(0, 8));
    }
  };

  const handleDeleteGroup = (name) => {
    const updated = savedGroups.filter((g) => g.name !== name);
    saveGroups(updated);
    setSavedGroups(updated);
  };

  return (
    <div className="peer-builder">
      <div className="peer-builder-title">Build Custom Peer Group</div>

      <div className="peer-builder-form">
        <div className="peer-builder-row">
          <label>
            State
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Charter Type
            <select value={charterType} onChange={(e) => setCharterType(e.target.value)}>
              <option value="">All types</option>
              <option value="Federal Credit Union">Federal</option>
              <option value="State-chartered Credit Union">State-chartered</option>
            </select>
          </label>
        </div>

        <div className="peer-builder-row">
          <label>
            Min Assets ($M)
            <input type="number" value={minAssets} onChange={(e) => setMinAssets(e.target.value)}
              placeholder="e.g. 50" min="0" />
          </label>
          <label>
            Max Assets ($M)
            <input type="number" value={maxAssets} onChange={(e) => setMaxAssets(e.target.value)}
              placeholder="e.g. 500" min="0" />
          </label>
        </div>

        <button type="button" className="peer-builder-btn" onClick={handlePreview} disabled={previewLoading}>
          {previewLoading ? 'Searching...' : 'Preview Group'}
        </button>
      </div>

      {/* Preview results */}
      {preview && (
        <div className="peer-builder-preview">
          <div className="peer-builder-preview-stats">
            <span><strong>{preview.count}</strong> CUs found</span>
            <span>Avg ROA: <span className="mono">{fmtPct(preview.avg_roa)}</span></span>
            <span>Avg NWR: <span className="mono">{fmtPct(preview.avg_nwr)}</span></span>
            <span>Total: <span className="mono">{fmtAssets(preview.total_assets)}</span></span>
          </div>

          {preview.institutions && preview.institutions.length > 0 && (
            <div className="peer-builder-list">
              {preview.institutions.slice(0, 10).map((inst) => (
                <div key={inst.cu_number} className="peer-builder-inst">
                  <span className="peer-builder-inst-name">{inst.name}</span>
                  <span className="mono">{inst.state} · {fmtAssets(inst.total_assets)}</span>
                </div>
              ))}
              {preview.count > 10 && (
                <div className="peer-builder-more">+{preview.count - 10} more</div>
              )}
            </div>
          )}

          <div className="peer-builder-save-row">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Name this group..."
            />
            <button type="button" className="peer-builder-btn" onClick={handleSave} disabled={!groupName.trim()}>
              Save
            </button>
            <button
              type="button"
              className="peer-builder-btn primary"
              onClick={() => onLoadGroup && onLoadGroup(preview.cu_numbers.slice(0, 8))}
            >
              Compare ({Math.min(preview.count, 8)})
            </button>
          </div>
        </div>
      )}

      {/* Saved groups */}
      {savedGroups.length > 0 && (
        <div className="peer-builder-saved">
          <div className="peer-builder-saved-title">Saved Peer Groups</div>
          {savedGroups.map((g) => (
            <div key={g.name} className="peer-builder-saved-item">
              <div className="peer-builder-saved-info">
                <span className="peer-builder-saved-name">{g.name}</span>
                <span className="peer-builder-saved-meta">{g.count} CUs</span>
              </div>
              <div className="peer-builder-saved-actions">
                <button type="button" onClick={() => handleLoadGroup(g)}>Load</button>
                <button type="button" className="delete" onClick={() => handleDeleteGroup(g.name)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
