export function downloadCSV(columns, rows, filename) {
  const header = columns.join(',');
  const lines = rows.map(row => columns.map(col => {
    const val = row[col];
    if (val == null) return '';
    if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) return `"${val.replace(/"/g, '""')}"`;
    return String(val);
  }).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
