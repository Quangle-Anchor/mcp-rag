import React from 'react';
import {
  Layers, Settings, MessageSquare, Palette,
  Activity, ShieldCheck, Sparkles, Terminal, Check
} from 'lucide-react';

export const THEMES = [
  { id: 'cyber-emerald', name: 'Cyber Emerald', color: '#10b981' },
  { id: 'obsidian-violet', name: 'Obsidian Violet', color: '#8b5cf6' },
  { id: 'titanium-cyan', name: 'Titanium Cyan', color: '#06b6d4' },
  { id: 'solar-amber', name: 'Solar Amber', color: '#f59e0b' },
  { id: 'lunar-light', name: 'Lunar Light', color: '#64748b' },
];

const Header = ({
  namespace,
  theme,
  onThemeChange,
  isChatOpen,
  onToggleChat,
  onOpenSettings,
  status = 'ready',
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopyNamespace = () => {
    if (namespace) {
      navigator.clipboard.writeText(namespace);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="app-header">
      {/* Brand */}
      <div className="header-brand">
        <div className="header-logo">
          <Layers size={18} color="#ffffff" />
        </div>
        <div>
          <div className="header-title">RAG Studio</div>
          <div className="header-subtitle">Production Pipeline Console</div>
        </div>
      </div>

      {/* Center metadata */}
      <div className="header-center">
        {/* Active Namespace Pill */}
        <button
          type="button"
          className="header-ns-pill"
          onClick={handleCopyNamespace}
          title="Click to copy active namespace"
        >
          <span className="ns-pill-dot" />
          <span className="ns-pill-label">Namespace:</span>
          <span className="ns-pill-value">{namespace || 'docs'}</span>
          {copied ? (
            <Check size={12} color="var(--accent-light)" />
          ) : null}
        </button>
      </div>

      {/* Header Actions */}
      <div className="header-actions">
        {/* Theme Picker */}
        <div className="header-theme-picker">
          <Palette size={13} color="var(--text-muted)" />
          <div className="header-theme-dots">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`theme-dot ${theme === t.id ? 'active' : ''}`}
                style={{ backgroundColor: t.color }}
                onClick={() => onThemeChange(t.id)}
                title={`Theme: ${t.name}`}
              />
            ))}
          </div>
        </div>

        {/* Chat Panel Toggle */}
        <button
          type="button"
          className={`btn btn-sm ${isChatOpen ? 'btn-primary' : 'btn-ghost'}`}
          onClick={onToggleChat}
        >
          <MessageSquare size={14} />
          <span>{isChatOpen ? 'Hide Chat' : 'Open Chat'}</span>
        </button>

        {/* Settings Button */}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onOpenSettings}
          title="Pipeline & Provider Settings"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
