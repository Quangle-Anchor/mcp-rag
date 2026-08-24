import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Trash2, Bot, User, Sparkles, Loader2,
  Clock, Layers, ChevronDown, ChevronUp, Copy, Check
} from 'lucide-react';
import { api } from '../../services/api';

const QUICK_PROMPTS = [
  'What errors are documented in this workspace?',
  'Summarize the generation failure analysis',
  'How does the error recovery flow work?',
];

const ChatConsole = ({ namespace, settings }) => {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'agent',
      text: 'Hello! I am connected to your RAG Studio pipeline. Ask questions about your synced documents or scanned source code.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const startTime = Date.now();

    try {
      const topK = settings?.topK ? Number(settings.topK) : 8;
      const res = await api.chat(query, namespace || 'docs', topK);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      const agentMsg = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        text: res.answer || res.response || 'No response returned from the model.',
        sources: res.sources || res.retrieved_chunks || [],
        elapsed,
        model: res.model || 'gemini-1.5-pro',
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages(prev => [...prev, agentMsg]);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Error executing query';
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'agent',
          isError: true,
          text: `Request failed: ${detail}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'agent',
        text: 'Chat history cleared. Active namespace is ready for new queries.',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const toggleChunkExpand = (msgId) => {
    setExpandedChunks(prev => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const handleCopyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="chat-console">
      {/* Chat Console Header */}
      <div className="chat-console-header">
        <div className="chat-header-title-wrap">
          <Bot size={17} color="var(--accent-light)" />
          <span className="chat-console-title">RAG Chat & Retrieval</span>
          <span className="badge badge-emerald">
            {namespace || 'docs'}
          </span>
        </div>

        <button
          type="button"
          className="btn btn-xs btn-ghost"
          onClick={handleClear}
          title="Clear conversation"
        >
          <Trash2 size={13} />
          <span>Clear</span>
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="chat-messages-area">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message-row ${msg.role}`}>
            <div className="chat-avatar">
              {msg.role === 'user' ? (
                <User size={14} color="#ffffff" />
              ) : (
                <Bot size={14} color="var(--accent-light)" />
              )}
            </div>

            <div className="chat-bubble-container">
              <div className={`chat-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}>
                <div className="chat-bubble-text">{msg.text}</div>

                {/* Sources / Retrieved Chunks Drawer */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="chat-sources-drawer">
                    <button
                      type="button"
                      className="sources-toggle-btn"
                      onClick={() => toggleChunkExpand(msg.id)}
                    >
                      <Layers size={12} />
                      <span>{msg.sources.length} Retrieved Context Chunks</span>
                      {expandedChunks[msg.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {expandedChunks[msg.id] && (
                      <div className="sources-list">
                        {msg.sources.map((src, i) => (
                          <div key={i} className="source-item">
                            <div className="source-item-header">
                              <span className="source-index">#{i + 1}</span>
                              <span className="source-file">{src.source || src.filename || 'Context'}</span>
                              {src.score && (
                                <span className="source-score">score: {Number(src.score).toFixed(3)}</span>
                              )}
                            </div>
                            <div className="source-snippet">
                              {src.content || src.text || JSON.stringify(src)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Message Metadata */}
              <div className="chat-msg-meta">
                <span>{msg.timestamp}</span>
                {msg.elapsed && (
                  <span className="meta-telemetry">
                    <Clock size={10} /> {msg.elapsed}s
                  </span>
                )}
                {msg.model && (
                  <span className="meta-model">{msg.model}</span>
                )}
                <button
                  type="button"
                  className="meta-copy-btn"
                  onClick={() => handleCopyText(msg.text, msg.id)}
                  title="Copy text"
                >
                  {copiedId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message-row agent">
            <div className="chat-avatar">
              <Bot size={14} color="var(--accent-light)" />
            </div>
            <div className="chat-bubble agent loading-bubble">
              <Loader2 size={15} className="animate-spin" color="var(--accent-light)" />
              <span>Retrieving hybrid context & generating answer…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      {messages.length <= 2 && !loading && (
        <div className="quick-prompts-bar">
          <span className="quick-prompt-label">
            <Sparkles size={12} /> Suggested:
          </span>
          {QUICK_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              type="button"
              className="quick-prompt-chip"
              onClick={() => handleSend(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input Bar */}
      <div className="chat-input-container">
        <form
          className="chat-input-form"
          onSubmit={e => {
            e.preventDefault();
            handleSend();
          }}
        >
          <input
            type="text"
            className="chat-text-input"
            placeholder={`Ask about workspace in "${namespace || 'docs'}"…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={!input.trim() || loading}
            title="Send query (Enter)"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </form>
        <div className="input-hint-row">
          <span>Press <code>Enter</code> to query hybrid retrieval</span>
          <span>Target: <code>{namespace || 'docs'}</code></span>
        </div>
      </div>
    </div>
  );
};

export default ChatConsole;
