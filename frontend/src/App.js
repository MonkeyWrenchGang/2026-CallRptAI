import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import OverviewRail from './components/OverviewRail';
import { useMediaQuery } from './hooks/useMediaQuery';
import './App.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

const SUGGESTIONS = [
  'Give me an overview of the top institutions by assets',
  'Compare bank vs credit union profitability',
  'Who has the highest NPL ratios? Any red flags?',
  'Show me the most efficient institutions',
  'What does our capital adequacy look like?',
  'Analyze the loan portfolio composition',
];

const INST_SUGGESTIONS = [
  'How are we performing overall?',
  'Show me our profitability trend',
  "What's our asset quality looking like?",
  'How do we compare to peers?',
  'Analyze our capital position',
  'Break down our loan portfolio',
];

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);

  const [institutions, setInstitutions] = useState([]);
  const [selectedInstitution, setSelectedInstitution] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSqlFor, setShowSqlFor] = useState(null);

  const [instSummary, setInstSummary] = useState(null);
  const [peersList, setPeersList] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState(false);

  const [overviewDrawerOpen, setOverviewDrawerOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > 900
  );

  const isNarrow = useMediaQuery('(max-width: 900px)');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!isNarrow || !overviewDrawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOverviewDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNarrow, overviewDrawerOpen]);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((d) => setAiEnabled(d.ai_enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/institutions/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          search: searchQuery,
          institution_type: typeFilter,
          limit: 100,
        }),
      })
        .then((r) => r.json())
        .then((d) => setInstitutions(d.institutions || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, typeFilter]);

  useEffect(() => {
    if (!isNarrow) {
      setOverviewDrawerOpen(true);
  } else {
      setOverviewDrawerOpen(false);
    }
  }, [isNarrow, selectedInstitution?.id]);

  useEffect(() => {
    if (!selectedInstitution) {
      setInstSummary(null);
      setPeersList([]);
      setOverviewError(false);
      return;
    }

    let cancelled = false;
    setOverviewLoading(true);
    setOverviewError(false);

    const id = selectedInstitution.id;
    Promise.all([
      fetch(`${API_BASE}/api/institutions/${id}`).then((r) => {
        if (!r.ok) throw new Error('detail');
        return r.json();
      }),
      fetch(`${API_BASE}/api/institutions/${id}/peers`).then((r) => {
        if (!r.ok) throw new Error('peers');
        return r.json();
      }),
    ])
      .then(([detail, peerData]) => {
        if (cancelled) return;
        setInstSummary(detail);
        setPeersList(peerData.peers || []);
      })
      .catch(() => {
        if (!cancelled) {
          setInstSummary(null);
          setPeersList([]);
          setOverviewError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedInstitution]);

  const sendMessage = async (text) => {
    if (!text.trim()) return;

    const userMsg = { role: 'user', content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          institution_id: selectedInstitution?.id || null,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await response.json();

      setSessionId(data.session_id);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          sql: data.sql_query,
          data: data.data,
          source: data.source,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Sorry, I had trouble connecting to the server. Make sure the backend is running on port 8000.',
          timestamp: new Date(),
        },
      ]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const selectInstitution = (inst) => {
    setSelectedInstitution(inst);
    setMessages([]);
    setSessionId(null);
    if (isNarrow) setOverviewDrawerOpen(false);
  };

  const clearSelection = () => {
    setSelectedInstitution(null);
    setMessages([]);
    setSessionId(null);
    setInstSummary(null);
    setPeersList([]);
  };

  const suggestions = selectedInstitution ? INST_SUGGESTIONS : SUGGESTIONS;
  const latestFinancial = instSummary?.financials?.[0] ?? null;

  const showRail = !!selectedInstitution;
  const railVisible = !isNarrow || overviewDrawerOpen;

  return (
    <div className="app">
      <header className="app-topbar">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden="true">
            CR
          </span>
          <div>
            <span className="topbar-title">CallRpt AI</span>
            <span className="topbar-sub">FFIEC &amp; NCUA</span>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Primary">
          <span className="topbar-nav-item">Overview</span>
          <span className="topbar-nav-item active">Ask</span>
        </nav>
        <div className="topbar-right">
          <span className={`topbar-pill ${aiEnabled ? 'on' : ''}`}>
            {aiEnabled ? 'Claude AI active' : 'Demo mode'}
          </span>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          sidebarOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          institutions={institutions}
          selectedInstitution={selectedInstitution}
          onSelectInstitution={selectInstitution}
          onClearSelection={clearSelection}
          aiEnabled={aiEnabled}
        />

        <div className="main-stack">
          {showRail && isNarrow && overviewDrawerOpen && (
            <button
              type="button"
              className="overview-backdrop"
              aria-label="Close overview"
              onClick={() => setOverviewDrawerOpen(false)}
            />
          )}

          <div className="hybrid-main">
            <ChatPanel
              sidebarOpen={sidebarOpen}
              onOpenSidebar={() => setSidebarOpen(true)}
              selectedInstitution={selectedInstitution}
              messages={messages}
              loading={loading}
              input={input}
              onInputChange={setInput}
              onSend={sendMessage}
              onKeyDown={handleKeyDown}
              suggestions={suggestions}
              showSqlFor={showSqlFor}
              onToggleSql={setShowSqlFor}
              inputRef={inputRef}
              messagesEndRef={messagesEndRef}
              showOverviewToggle={showRail && isNarrow}
              overviewOpen={overviewDrawerOpen}
              onToggleOverview={() => setOverviewDrawerOpen((o) => !o)}
            />

            {showRail && (
              <div
                className={`overview-rail-wrap ${railVisible ? 'is-open' : ''} ${isNarrow ? 'is-drawer' : ''}`}
              >
                <OverviewRail
                  loading={overviewLoading}
                  error={overviewError}
                  institution={instSummary?.institution || selectedInstitution}
                  latestFinancial={latestFinancial}
                  peers={peersList}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
