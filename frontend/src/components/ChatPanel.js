import React from 'react';
import ReactMarkdown from 'react-markdown';
import { fmtAssets } from '../utils/format';
import ChartRenderer from './ChartRenderer';
import DataTable from './DataTable';

const QUICK_PROMPTS = [
  '8Q NWR trend',
  'Compare to peers',
  'Explain delinquency spike',
  'Member growth outlook',
];

export default function ChatPanel({
  sidebarOpen,
  onOpenSidebar,
  selectedInstitution,
  messages,
  loading,
  input,
  onInputChange,
  onSend,
  onKeyDown,
  suggestions,
  showSqlFor,
  onToggleSql,
  inputRef,
  messagesEndRef,
  showOverviewToggle,
  overviewOpen,
  onToggleOverview,
  onQuickCompare,
}) {
  return (
    <main className="chat-area">
      <header className="chat-header">
        <div className="chat-header-left">
          {!sidebarOpen && (
            <button
              type="button"
              className="sidebar-toggle-main"
              onClick={onOpenSidebar}
              aria-label="Open institutions sidebar"
            >
              ☰
            </button>
          )}
          <div>
            <h2>
              {selectedInstitution ? selectedInstitution.name : 'Market overview'}
            </h2>
            {selectedInstitution && (
              <span className="header-detail">
                Credit Union
                {selectedInstitution.state && <> · {selectedInstitution.state}</>}
                {selectedInstitution.total_assets != null && (
                  <> · {fmtAssets(selectedInstitution.total_assets)}</>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="chat-header-right">
          {selectedInstitution && onQuickCompare && (
            <button
              type="button"
              className="quick-compare-btn"
              onClick={onQuickCompare}
            >
              Compare CU
            </button>
          )}
          {showOverviewToggle && (
            <button
              type="button"
              className="overview-toggle-btn"
              onClick={onToggleOverview}
              aria-expanded={overviewOpen}
              aria-controls="overview-rail-panel"
            >
              {overviewOpen ? 'Hide overview' : 'Overview'}
            </button>
          )}
          <div className="header-badge">NCUA 5300 call report intelligence</div>
        </div>
      </header>

      <div className="messages-container">
        {messages.length === 0 && (
          <div className="welcome">
            <div className="welcome-mark" aria-hidden="true">CR</div>
            <h2>Welcome to CallRpt AI</h2>
            <p>
              Ask executive-level questions about{' '}
              {selectedInstitution ? selectedInstitution.name : 'credit unions'} using NCUA 5300 call report data.
            </p>

            {/* Quick prompt chips */}
            {selectedInstitution && (
              <div className="quick-chips">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="quick-chip"
                    onClick={() => onSend(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <div className="suggestions">
              {suggestions.map((s, i) => (
                <button key={i} type="button" className="suggestion-btn" onClick={() => onSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-avatar" aria-hidden="true">
              {msg.role === 'user' ? 'You' : 'CR'}
            </div>
            <div className="message-content">
              {msg.role === 'assistant' ? (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              ) : (
                <p>{msg.content}</p>
              )}
              {/* Chart visualization */}
              {msg.vizConfig && msg.resultData && (
                <ChartRenderer vizConfig={msg.vizConfig} data={msg.resultData} />
              )}
              {/* Data table */}
              {msg.resultData && msg.resultData.row_count > 0 && (
                <DataTable columns={msg.resultData.columns} rows={msg.resultData.rows} />
              )}
              {/* NCUA citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="message-citations">
                  <span className="citations-label">Sources:</span>
                  {msg.citations.map((c, ci) => (
                    <span key={ci} className="citation-chip">{c}</span>
                  ))}
                </div>
              )}
              {msg.sql && (
                <div className="sql-toggle">
                  <button
                    type="button"
                    onClick={() => onToggleSql(showSqlFor === idx ? null : idx)}
                  >
                    {showSqlFor === idx ? 'Hide SQL' : 'View SQL query'}
                  </button>
                  {showSqlFor === idx && <pre className="sql-block">{msg.sql}</pre>}
                </div>
              )}
              {msg.source && (
                <div className="message-source">
                  {msg.source === 'claude' ? 'Claude AI' : 'Template engine'}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <div className="message-avatar" aria-hidden="true">
              CR
            </div>
            <div className="message-content">
              <div className="typing-indicator" aria-label="Assistant is typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <label htmlFor="chat-input" className="visually-hidden">
            Message
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              selectedInstitution
                ? `Ask about ${selectedInstitution.name}…`
                : 'Ask about credit unions, peer trends, or portfolio risk…'
            }
            rows={1}
          />
          <button
            type="button"
            className="send-btn"
            onClick={() => onSend(input)}
            disabled={loading || !input.trim()}
          >
            Send
          </button>
        </div>
        <div className="input-footer">
          Data from NCUA 5300 quarterly call reports · Prototype — not financial advice
        </div>
      </div>
    </main>
  );
}
