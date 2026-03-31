import React, { useState } from 'react';

export default function EmbedPanel({ activeCU }) {
  const [copied, setCopied] = useState(null);

  const baseUrl = window.location.origin;

  const widgets = [
    {
      id: 'cu-detail',
      label: 'CU Detail Widget',
      description: 'Embed a summary card for a specific credit union. Shows key metrics, health score, and trends.',
      url: activeCU ? `${baseUrl}/embed/cu/${activeCU}` : `${baseUrl}/embed/cu/{cu_number}`,
      width: 400,
      height: 300,
      needsCU: true,
    },
    {
      id: 'pulse',
      label: 'Market Pulse Widget',
      description: 'Embed the industry pulse summary showing aggregate KPIs, health score, and top movers.',
      url: `${baseUrl}/embed/pulse`,
      width: 500,
      height: 400,
      needsCU: false,
    },
  ];

  const generateSnippet = (w) =>
    `<iframe src="${w.url}" width="${w.width}" height="${w.height}" frameBorder="0"></iframe>`;

  const handleCopy = (id, snippet) => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <section className="compare-area">
      <div className="compare-header">
        <h2>Embeddable Widgets</h2>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Generate embed codes to place CallRpt AI widgets on your website, intranet, or dashboard.
        Copy the HTML snippet and paste it into any page that supports iframes.
      </p>

      <div className="embed-widgets-grid">
        {widgets.map((w) => {
          const snippet = generateSnippet(w);
          return (
            <div key={w.id} className="embed-widget-card">
              <h3 className="embed-widget-title">{w.label}</h3>
              <p className="embed-widget-desc">{w.description}</p>
              {w.needsCU && !activeCU && (
                <p className="embed-widget-warn">
                  Select a credit union first, or replace <code>{'{cu_number}'}</code> in the URL with a valid CU number.
                </p>
              )}
              <div className="embed-snippet-wrap">
                <pre className="embed-snippet mono">{snippet}</pre>
                <button
                  type="button"
                  className="embed-copy-btn"
                  onClick={() => handleCopy(w.id, snippet)}
                >
                  {copied === w.id ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="embed-preview-label">Preview dimensions: {w.width} x {w.height}px</div>
            </div>
          );
        })}
      </div>

      <div className="embed-info-section">
        <h3>Usage Notes</h3>
        <ul className="embed-info-list">
          <li>Widgets auto-refresh with the latest quarterly data.</li>
          <li>Responsive within the iframe — adjust width/height as needed.</li>
          <li>Widgets inherit no external styles; they are fully self-contained.</li>
          <li>For authenticated environments, ensure your CSP allows framing from this origin.</li>
        </ul>
      </div>
    </section>
  );
}
