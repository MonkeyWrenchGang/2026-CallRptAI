import React, { useState, useEffect, useCallback } from 'react';
import { fmtAssets, fmtPct, fmtPctChange, capitalLabel } from '../utils/format';
import { downloadCSV } from '../utils/csv';

const STORAGE_KEY = 'callrptai_watchlist';

function readWatchlist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeWatchlist(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function isWatched(cuNumber) {
  return readWatchlist().includes(String(cuNumber));
}

export function toggleWatch(cuNumber) {
  const num = String(cuNumber);
  const list = readWatchlist();
  if (list.includes(num)) {
    const next = list.filter((n) => n !== num);
    writeWatchlist(next);
    return false;
  } else {
    writeWatchlist([...list, num]);
    return true;
  }
}

export default function WatchlistPanel({ onSelectInstitution }) {
  const [watchlist, setWatchlist] = useState(readWatchlist);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    const list = readWatchlist();
    setWatchlist(list);
  }, []);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [refresh]);

  useEffect(() => {
    if (watchlist.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/ncua/compare?cu_numbers=${watchlist.join(',')}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) { setData(d); setLoading(false); }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [watchlist]);

  const handleRemove = (cuNumber) => {
    toggleWatch(cuNumber);
    refresh();
  };

  const handleSelect = (cu) => {
    if (onSelectInstitution) {
      onSelectInstitution({
        cu_number: cu.institution?.cu_number,
        name: cu.institution?.name,
        state: cu.institution?.state,
      });
    }
  };

  const cus = data?.cus || [];

  const handleExportCSV = () => {
    const columns = ['Name', 'State', 'Assets', 'ROA', 'NWR', 'Delinquency', 'CAMEL'];
    const rows = cus.map((cu) => ({
      Name: cu.institution?.name || '',
      State: cu.institution?.state || '',
      Assets: cu.latest?.total_assets || '',
      ROA: cu.latest?.roa != null ? (cu.latest.roa * 100).toFixed(2) + '%' : '',
      NWR: cu.latest?.net_worth_ratio != null ? (cu.latest.net_worth_ratio * 100).toFixed(2) + '%' : '',
      Delinquency: cu.latest?.delinquency_ratio != null ? (cu.latest.delinquency_ratio * 100).toFixed(2) + '%' : '',
      CAMEL: cu.latest?.camel_class || '',
    }));
    downloadCSV(columns, rows, 'watchlist.csv');
  };

  return (
    <main className="compare-area">
      <header className="compare-header">
        <h2>Watchlist</h2>
        {cus.length > 0 && (
          <button type="button" className="export-csv-btn" onClick={handleExportCSV}>
            Export CSV
          </button>
        )}
      </header>

      {watchlist.length === 0 && !loading && (
        <p className="compare-message">
          Your watchlist is empty. Use the "Watch" button on any credit union's overview panel to add it here.
        </p>
      )}

      {loading && <p className="compare-message">Loading watchlist data...</p>}

      {!loading && cus.length > 0 && (
        <div className="landscape-table-wrap">
          <table className="landscape-table watchlist-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Assets</th>
                <th>ROA</th>
                <th>NWR</th>
                <th>Delinquency</th>
                <th>CAMEL</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cus.map((cu) => {
                const latest = cu.latest || {};
                const trend = cu.trend || [];
                const prevQ = trend.length >= 2 ? trend[1] : null;
                const nwrWarn = latest.net_worth_ratio != null && latest.net_worth_ratio < 0.10;
                const delWarn = latest.delinquency_ratio != null && latest.delinquency_ratio > 0.02;
                const rowClass = (nwrWarn || delWarn) ? 'watchlist-row-warn' : '';

                return (
                  <tr key={cu.institution?.cu_number} className={rowClass}>
                    <td>
                      <button
                        type="button"
                        className="pulse-link"
                        onClick={() => handleSelect(cu)}
                      >
                        {cu.institution?.name}
                      </button>
                    </td>
                    <td>{cu.institution?.state}</td>
                    <td className="mono">{fmtAssets(latest.total_assets)}</td>
                    <td className="mono">
                      {fmtPct(latest.roa)}
                      {prevQ?.roa != null && latest.roa != null && (
                        <span className={latest.roa >= prevQ.roa ? 'qoq-up' : 'qoq-down'}>
                          {latest.roa >= prevQ.roa ? ' \u25B2' : ' \u25BC'}
                        </span>
                      )}
                    </td>
                    <td className={`mono ${nwrWarn ? 'text-neg' : ''}`}>
                      {fmtPct(latest.net_worth_ratio)}
                      {prevQ?.net_worth_ratio != null && latest.net_worth_ratio != null && (
                        <span className={latest.net_worth_ratio >= prevQ.net_worth_ratio ? 'qoq-up' : 'qoq-down'}>
                          {latest.net_worth_ratio >= prevQ.net_worth_ratio ? ' \u25B2' : ' \u25BC'}
                        </span>
                      )}
                    </td>
                    <td className={`mono ${delWarn ? 'text-neg' : ''}`}>
                      {fmtPct(latest.delinquency_ratio)}
                    </td>
                    <td className="mono">{capitalLabel(latest.camel_class)}</td>
                    <td>
                      <button
                        type="button"
                        className="watchlist-remove-btn"
                        onClick={() => handleRemove(cu.institution?.cu_number)}
                        aria-label={`Remove ${cu.institution?.name}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
