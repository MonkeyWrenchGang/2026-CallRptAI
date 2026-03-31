import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ReportBuilderPanel({ activeCU, selectedInstitution }) {
  const [prompt, setPrompt] = useState('');
  const [cuOverride, setCuOverride] = useState('');
  const [quarterCount, setQuarterCount] = useState(2);
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const reportRef = useRef(null);

  const cuNumber = cuOverride.trim() || activeCU || null;
  const cuLabel = selectedInstitution?.name || cuNumber || 'Industry';

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setReport('');
    setCopied(false);

    try {
      const enrichedPrompt = `${prompt.trim()} (Cover the last ${quarterCount} quarters.)`;
      const res = await fetch('/api/ncua/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: enrichedPrompt,
          cu_number: cuNumber,
          history: [],
        }),
      });
      const data = await res.json();
      setReport(data.answer || data.message || 'No response generated.');
    } catch (err) {
      setError('Failed to generate report. Is the backend running?');
    }
    setLoading(false);
  };

  const handlePrint = () => {
    const content = reportRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Report - ${cuLabel}</title>
      <style>
        body { font-family: 'IBM Plex Sans', -apple-system, sans-serif; padding: 40px; color: #1a1a18; line-height: 1.6; }
        h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        h3 { font-size: 14px; margin-top: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
        th { text-align: left; background: #f7f7f5; padding: 5px 8px; border-bottom: 1px solid #ddd; }
        td { padding: 4px 8px; border-bottom: 1px solid #eee; }
        p { margin: 8px 0; font-size: 13px; }
        ul, ol { margin: 8px 0 8px 20px; font-size: 13px; }
        .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 10px; color: #9c9a92; }
        @media print { body { padding: 15px; } }
      </style></head><body>
      <h1>Report: ${cuLabel}</h1>
      ${content.innerHTML}
      <div class="footer">CallRpt AI Report Builder · Generated ${new Date().toLocaleDateString()} · NCUA 5300 Data · Not financial advice</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <main className="compare-area report-builder-panel">
      <header className="compare-header">
        <h2>Report Builder</h2>
        {cuLabel && <span className="compare-quarter-label">{cuLabel}</span>}
      </header>

      <section className="rb-controls">
        <label className="rb-label" htmlFor="rb-prompt">
          Describe the report you need
        </label>
        <textarea
          id="rb-prompt"
          className="rb-textarea"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g. "Build me a board report comparing Q3 to Q4 focusing on loan growth for Navy Federal"'
        />

        <div className="rb-options-row">
          <div className="rb-option">
            <label className="rb-option-label" htmlFor="rb-cu-override">
              CU # override
            </label>
            <input
              id="rb-cu-override"
              type="text"
              className="rb-input"
              value={cuOverride}
              onChange={(e) => setCuOverride(e.target.value)}
              placeholder={activeCU || 'auto'}
            />
          </div>

          <div className="rb-option">
            <label className="rb-option-label" htmlFor="rb-quarters">
              Quarters
            </label>
            <select
              id="rb-quarters"
              className="rb-select"
              value={quarterCount}
              onChange={(e) => setQuarterCount(Number(e.target.value))}
            >
              <option value={2}>2 Quarters</option>
              <option value={4}>4 Quarters (1 Year)</option>
              <option value={8}>8 Quarters (2 Years)</option>
            </select>
          </div>

          <button
            type="button"
            className="rb-generate-btn"
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
          >
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </section>

      {error && <p className="compare-message error">{error}</p>}

      {loading && <p className="compare-message">Generating your report...</p>}

      {report && !loading && (
        <section className="rb-result">
          <div className="rb-result-actions">
            <button type="button" className="pulse-print-btn" onClick={handlePrint}>
              Print / PDF
            </button>
            <button type="button" className="pulse-print-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
          <div className="rb-markdown" ref={reportRef}>
            <ReactMarkdown>{report}</ReactMarkdown>
          </div>
        </section>
      )}

      {!report && !loading && !error && (
        <p className="compare-message">
          Describe the report you want and click Generate. The AI will produce a formatted analysis using NCUA call report data.
        </p>
      )}
    </main>
  );
}
