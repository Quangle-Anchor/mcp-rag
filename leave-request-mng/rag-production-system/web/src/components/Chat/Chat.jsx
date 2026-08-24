import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Terminal, Loader2, Cpu,
  RotateCcw, Zap, AlertCircle
} from 'lucide-react';
import { api } from '../../services/api';

// ─── Markdown-lite renderer ──────────────────────────────────────────────────
function MiniMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, li) => {
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        return (
          <span key={li}>
            {parts.map((part, pi) => {
              if (part.startsWith('**') && part.endsWith('**'))
                return <strong key={pi}>{part.slice(2, -2)}</strong>;
              if (part.startsWith('`') && part.endsWith('`'))
                return (
                  <code key={pi} style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.82em',
                    background: 'rgba(255,255,255,0.08)', padding: '1px 5px',
                    borderRadius: 4, color: '#a78bfa',
                  }}>{part.slice(1, -1)}</code>
                );
              return part;
            })}
            {li < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

const Chat = ({ namespace, settings }) => {
  const [messages, setMessages] = useState([
    {
      id: 1, role: 'agent',
      text: 'Hello! I\'m connected to your RAG pipeline.\nSend a query to retrieve context using **Hybrid Search** (BM25 + Dense + RRF fusion).',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      const response = await api.chat(userQuery, namespace, topK);

      const count = response.sources?.length ?? 0;
      const latency = response.latency_ms;

      let messageText = '';
      if (response.answer) {
        messageText = response.answer;
      } else if (count > 0) {
        messageText = `Retrieved **${count} chunk${count !== 1 ? 's' : ''}** from \`${namespace}\`.`;
      } else {
        messageText = 'No relevant chunks found. Try rephrasing.';
      }

      addMessage({ role: 'agent', text: messageText, latency, chunkCount: count });
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Unknown error';
      addMessage({ role: 'agent', text: `**Error:** ${detail}`, isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([{
      id: Date.now(), role: 'agent',
      text: 'Chat cleared. Send a new query.',
    }]);
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <Terminal size={15} color="var(--accent-light)" />
          <span className="chat-title">Chat</span>
          <span className="chat-namespace-badge">{namespace || 'docs'}</span>
        </div>
        <button
          className="btn btn-xs btn-icon"
          onClick={handleClear}
          title="Clear chat"
          style={{ color: 'var(--text-muted)' }}
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-bubble" style={msg.isError ? {
              borderColor: 'var(--red-border)', background: 'var(--red-bg)',
            } : {}}>
              {msg.isError && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 3, color: 'var(--red)', fontWeight: 600, fontSize: '0.78rem' }}>
                  <AlertCircle size={11} /> Error
                </span>
              )}
              <MiniMarkdown text={msg.text} />
            </div>
            {(msg.latency || msg.chunkCount != null) && (
              <div className="message-meta">
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Cpu size={10} /> RAG
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {msg.latency != null && <><Zap size={10} />{msg.latency}ms</>}
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
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>
                Searching…
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-bar">
        <form onSubmit={handleSend} className="chat-input-form">
          <input
            type="text"
            className="chat-input"
            placeholder={`Search "${namespace}"…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="chat-submit-btn" disabled={!input.trim() || loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Chat;
