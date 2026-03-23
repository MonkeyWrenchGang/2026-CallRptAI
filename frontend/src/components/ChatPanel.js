import React from 'react';
import ReactMarkdown from 'react-markdown';
import { formatAssets } from '../utils/format';

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
                {selectedInstitution.institution_type === 'bank' ? 'Bank' : 'Credit union'}
                {' · '}
                {selectedInstitution.state}
                {' · '}
                {formatAssets(selectedInstitution.total_assets_latest)}
              </span>
            )}
          </div>
        </div>
        <div className="chat-header-right">
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
          <div className="header-badge">FFIEC &amp; NCUA call reports</div>
        </div>
      </header>

      <div className="messages-container">
        {messages.length === 0 && (
          <div className="welcome">
            <div className="welcome-mark" aria-hidden="true">CR</div>
            <h2>Welcome to CallRpt AI</h2>
            <p>
              Ask executive-level questions about{' '}
              {selectedInstitution ? selectedInstitution.name : 'banks and credit unions'} using FFIEC and
              NCUA call report data.
            </p>
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
                ? `Ask about ${selectedInstitution.name}...`
                : 'Ask about banks, credit unions, or market trends...'
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
          Data from FFIEC &amp; NCUA quarterly call reports · Prototype — not financial advice
        </div>
      </div>
    </main>
  );
}
