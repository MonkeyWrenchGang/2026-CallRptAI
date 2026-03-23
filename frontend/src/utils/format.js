/** Format total_assets_latest (thousands) for display */
export function formatAssets(thousands) {
  if (thousands == null || thousands === '') return '—';
  const millions = thousands / 1000;
  if (millions >= 1000) return `$${(millions / 1000).toFixed(1)}B`;
  return `$${millions.toFixed(0)}M`;
}

/** Ratio stored as decimal (e.g. 0.0112) → percentage string */
export function formatPct(value, fractionDigits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/** Report date label for latest quarter */
export function formatReportDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
