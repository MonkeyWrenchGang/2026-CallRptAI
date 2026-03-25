/** Format raw asset value in dollars (e.g. 197166186107) for display */
export function fmtAssets(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Decimal ratio → percentage string, e.g. 0.0969 → "9.69%" */
export function fmtPct(n, decimals = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${(Number(n) * 100).toFixed(decimals)}%`;
}

/** Decimal ratio → percentage with explicit sign, e.g. 0.012 → "+1.20%" */
export function fmtPctChange(n, decimals = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n) * 100;
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
}

/** Format member count, e.g. 15139001 → "15.1M", 142000 → "142K" */
export function fmtMembers(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

/** Decimal ratio → percentage with configurable decimals, e.g. 0.8562 → "85.6%" */
export function fmtRatio(n, decimals = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${(Number(n) * 100).toFixed(decimals)}%`;
}

/** Map NCUA camel_class string to a short display label */
export function capitalLabel(camel_class) {
  if (!camel_class) return '—';
  const map = {
    'Well Capitalized': 'Well Cap.',
    'Adequately Capitalized': 'Adequate',
    'Undercapitalized': 'Under Cap.',
    'Significantly Undercapitalized': 'Sig. Under',
    'Critically Undercapitalized': 'Critical',
  };
  return map[camel_class] || camel_class;
}

// ── Legacy helpers kept for backward-compat ───────────────────────────────

/** @deprecated use fmtAssets */
export function formatAssets(thousands) {
  if (thousands == null || thousands === '') return '—';
  const millions = thousands / 1000;
  if (millions >= 1000) return `$${(millions / 1000).toFixed(1)}B`;
  return `$${millions.toFixed(0)}M`;
}

/** @deprecated use fmtPct */
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
