import React from 'react';
import { SquareStack, Settings, Layers, MessageSquare, Palette } from 'lucide-react';

const THEMES = [
  { id: 'cyber-emerald', name: 'Cyber Emerald', color: '#10b981' },
  { id: 'obsidian-violet', name: 'Obsidian Violet', color: '#8b5cf6' },
  { id: 'titanium-cyan', name: 'Titanium Cyan', color: '#06b6d4' },
  { id: 'solar-amber', name: 'Solar Amber', color: '#f59e0b' },
  { id: 'lunar-light', name: 'Lunar Light', color: '#64748b' },
];

const Sidebar = ({
  namespace,
  setNamespace,
  settings,
  onOpenSettings,
  isChatOpen,
  onToggleChat,
  theme = 'cyber-emerald',
  onThemeChange,
}) => {
  const hasKeys = Boolean(settings?.googleApiKey) && Boolean(settings?.pineconeApiKey || settings?.vectorBackend !== 'pinecone');

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <SquareStack size={18} color="white" />
          </div>
          <div>
            <div className="sidebar-title">RAG Engine</div>
            <div className="sidebar-subtitle">BYOA Studio</div>
          </div>
        </div>
      </div>

      <div className="sidebar-body">
        {/* Theme Picker */}
        <div className="theme-picker-card">
          <div className="theme-picker-label">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Palette size={12} />
              <span>Theme</span>
            </div>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'capitalize', fontWeight: 500 }}>
              {THEMES.find(t => t.id === theme)?.name || theme}
            </span>
          </div>
          <div className="theme-options-row">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`theme-option-dot ${theme === t.id ? 'active' : ''}`}
                style={{ backgroundColor: t.color }}
                onClick={() => onThemeChange && onThemeChange(t.id)}
                title={t.name}
              />
            ))}
          </div>
        </div>

        {/* Namespace */}
        <div className="section-card">
          <div className="section-card-header">
            <Layers size={13} /> Namespace
          </div>
          <div className="section-card-body">
            <div className="input-group">
              <label className="input-label" htmlFor="sb-namespace">Active Namespace</label>
              <input
                id="sb-namespace"
                type="text"
                className="input-field"
                value={namespace}
                onChange={e => setNamespace(e.target.value)}
                placeholder="e.g. docs"
              />
            </div>
          </div>
        </div>

        {/* Toggle chat */}
        <button
          className={`btn btn-block ${isChatOpen ? 'btn-primary' : ''}`}
          onClick={onToggleChat}
        >
          <MessageSquare size={14} />
          {isChatOpen ? 'Hide Chat' : 'Show Chat'}
        </button>

        {/* Settings */}
        <button
          className="btn btn-block"
          onClick={onOpenSettings}
          style={{ marginTop: 'auto' }}
        >
          <Settings size={14} /> Settings
        </button>
      </div>

      <div className="sidebar-footer">
        <div className={`status-dot ${hasKeys ? 'animate-pulse-glow' : 'offline'}`} />
        <span>{hasKeys ? 'Keys configured' : 'Missing API keys'}</span>
      </div>
    </div>
  );
};

export default Sidebar;
