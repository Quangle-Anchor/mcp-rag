import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Terminal, Loader2, Code2, Cpu,
  RotateCcw, Zap, AlertCircle
} from 'lucide-react';
import { api } from '../../services/api';

// ─── Markdown-lite renderer ──────────────────────────────────────────────────
// Renders **bold**, `code`, and line breaks — lightweight, no dependency.
function MiniMarkdown({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, li) => {
        // Bold: **text**
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        return (
          <span key={li}>
            {parts.map((part, pi) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={pi}>{part.slice(2, -2)}</strong>;
              }
              if (part.startsWith('`') && part.endsWith('`')) {
                return (
                  <code key={pi} style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82em',
                    background: 'rgba(255,255,255,0.08)',
                    padding: '1px 5px',
                    borderRadius: 4,
                    color: '#a78bfa',
                  }}>{part.slice(1, -1)}</code>
                );
              }
              return part;
            })}
            {li < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

// ─── Chat component ──────────────────────────────────────────────────────────

const Chat = ({ namespace, settings, onChunksRetrieved, isContextOpen, setIsContextOpen }) => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'agent',
      text: 'Hello! I\'m connected to your RAG pipeline.\nSend a query to retrieve context from the vector database using **Hybrid Search** (BM25 + Dense + RRF fusion).',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const addMessage = (msg) =>
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), ...msg }]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userQuery = input.trim();
    setInput('');
    addMessage({ role: 'user', text: userQuery });
    setLoading(true);

    try {
      const topK = settings?.topK ?? 8;
      const baseURL = settings?.apiBaseUrl;
      const response = await api.chat(userQuery, namespace, topK, baseURL);

      if (response.sources && response.sources.length > 0) {
        onChunksRetrieved(response.sources);
        if (!isContextOpen) setIsContextOpen(true);
      }

      const count = response.sources?.length ?? 0;
      const latency = response.latency_ms;

      let messageText = '';
      if (count > 0) {
        messageText = `Retrieved **${count} chunk${count !== 1 ? 's' : ''}** from \`${namespace}\` namespace. Context is ready in the Inspector panel.`;
      } else if (response.answer) {
        messageText = response.answer;
      } else {
        messageText = 'No relevant chunks found for that query. Try rephrasing or adjusting the Top-K or BM25 weights in Tuning.';
      }

      addMessage({
        role: 'agent',
        text: messageText,
        latency,
        chunkCount: count,
      });
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Unknown error';
      addMessage({
        role: 'agent',
        text: `**Error:** ${detail}`,
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([{
      id: Date.now(),
      role: 'agent',
      text: 'Chat cleared. Send a new query to retrieve context from the vector database.',
    }]);
    onChunksRetrieved([]);
    setIsContextOpen(false);
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <Terminal size={18} color="var(--accent-light)" />
          <span className="chat-title">Query Interface</span>
          <span className="chat-namespace-badge">{namespace || 'docs'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="btn btn-sm btn-icon"
            onClick={handleClear}
            title="Clear chat"
            style={{ color: 'var(--text-muted)' }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setIsContextOpen(v => !v)}
            style={{
              background: isContextOpen ? 'var(--accent-subtle)' : undefined,
              color: isContextOpen ? 'var(--accent-light)' : undefined,
              borderColor: isContextOpen ? 'rgba(139,92,246,0.3)' : undefined,
            }}
          >
            <Code2 size={14} />
            {isContextOpen ? 'Hide Context' : 'View Context'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-bubble" style={msg.isError ? {
              borderColor: 'var(--red-border)',
              background: 'var(--red-bg)',
            } : {}}>
              {msg.isError && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 3, color: 'var(--red)', fontWeight: 600, fontSize: '0.82rem' }}>
                  <AlertCircle size={13} /> Error
                </span>
              )}
              <MiniMarkdown text={msg.text} />
            </div>
            {(msg.latency || msg.chunkCount != null) && (
              <div className="message-meta">
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Cpu size={10} /> RAG Pipeline
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {msg.latency != null && (
                    <><Zap size={10} />{msg.latency}ms</>
                  )}
                </span>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="message agent">
            <div className="message-bubble">
              <div className="typing-dots">
                <span /><span /><span />
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 4 }}>
                Running Hybrid Search…
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <form onSubmit={handleSend} className="chat-input-form">
          <input
            type="text"
            className="chat-input"
            placeholder={`Search "${namespace}" — e.g. BR-02, leave approval flow…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="chat-submit-btn" disabled={!input.trim() || loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Chat;
