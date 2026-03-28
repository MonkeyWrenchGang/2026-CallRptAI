import React, { useState } from 'react';

export default function DataTable({ columns, rows }) {
  const [expanded, setExpanded] = useState(false);

  if (!rows || rows.length === 0 || !columns || columns.length === 0) return null;

  const displayRows = expanded ? rows.slice(0, 50) : rows.slice(0, 5);

  return (
    <div className="data-table-wrap">
      <button
        type="button"
        className="data-table-toggle"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? 'Hide data' : `View data (${rows.length} rows)`}
      </button>
      {expanded && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col.replace(/_/g, ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col} className={typeof row[col] === 'number' ? 'mono' : ''}>
                      {formatCell(col, row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && (
            <div className="data-table-overflow">Showing 50 of {rows.length} rows</div>
          )}
        </>
      )}
    </div>
  );
}

const RATIO_COLS = [
  'roa', 'net_worth_ratio', 'net_interest_margin', 'delinquency_ratio',
  'efficiency_ratio', 'loan_to_share_ratio', 'nwr', 'nim', 'roa_curr',
  'roa_delta', 'roa_prev',
];

const DOLLAR_COLS = [
  'total_assets', 'total_loans', 'total_shares', 'total_equity', 'cash',
  'net_income', 'interest_income', 'interest_expense', 'net_interest_income',
  'noninterest_expense', 'assets',
];

function formatCell(colName, value) {
  if (value == null) return '—';
  if (typeof value !== 'number') return String(value);

  const col = colName.toLowerCase();

  if (RATIO_COLS.some((r) => col.includes(r))) {
    return `${(value * 100).toFixed(2)}%`;
  }

  if (DOLLAR_COLS.some((d) => col.includes(d))) {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }

  if (col.includes('member') || col.includes('count')) {
    return value.toLocaleString();
  }

  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}
