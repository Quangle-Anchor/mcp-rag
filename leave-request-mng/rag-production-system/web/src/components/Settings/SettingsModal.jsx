import React, { useState } from 'react';
import {
  X, Save, Key, Sliders, Database, Cpu,
  CheckCircle2, Shield, Info
} from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, settings, onSaveSettings }) => {
  const [localSettings, setLocalSettings] = useState(settings || {
    googleApiKey: '',
    openaiApiKey: '',
    llmProvider: 'google',
    embeddingProvider: 'google',
    topK: 8,
    vectorBackend: 'pinecone',
  });
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value,
    }));
    setSaved(false);
  };

  const handleSave = (e) => {
    e.preventDefault();
    onSaveSettings(localSettings);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <Sliders size={18} color="var(--accent-light)" />
            <h3 className="modal-title">Studio & Provider Settings</h3>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-icon"
            onClick={onClose}
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="modal-form">
          {/* LLM Provider */}
          <div className="form-group">
            <label className="form-label" htmlFor="llm-provider">
              <Cpu size={13} /> LLM Model Provider
            </label>
            <select
              id="llm-provider"
              className="form-select"
              value={localSettings.llmProvider || 'google'}
              onChange={e => handleChange('llmProvider', e.target.value)}
            >
              <option value="google">Google Gemini (gemini-1.5-pro / flash)</option>
              <option value="openai">OpenAI (gpt-4o / gpt-4o-mini)</option>
              <option value="anthropic">Anthropic (claude-3-5-sonnet)</option>
              <option value="groq">Groq (llama-3.3-70b)</option>
            </select>
          </div>

          {/* Google API Key */}
          <div className="form-group">
            <label className="form-label" htmlFor="google-api-key">
              <Key size={13} /> Google Gemini API Key
            </label>
            <input
              id="google-api-key"
              type="password"
              className="form-input"
              placeholder="AIzaSy…"
              value={localSettings.googleApiKey || ''}
              onChange={e => handleChange('googleApiKey', e.target.value)}
            />
            <span className="form-hint">Stored in local browser storage for BYOA execution.</span>
          </div>

          {/* OpenAI API Key */}
          <div className="form-group">
            <label className="form-label" htmlFor="openai-api-key">
              <Key size={13} /> OpenAI API Key (Optional)
            </label>
            <input
              id="openai-api-key"
              type="password"
              className="form-input"
              placeholder="sk-proj-…"
              value={localSettings.openaiApiKey || ''}
              onChange={e => handleChange('openaiApiKey', e.target.value)}
            />
          </div>

          {/* Top-K Retrieval */}
          <div className="form-group">
            <div className="form-label-row">
              <label className="form-label" htmlFor="top-k-slider">
                <Database size={13} /> Top-K Retrieval Depth
              </label>
              <span className="form-value-pill">{localSettings.topK || 8} chunks</span>
            </div>
            <input
              id="top-k-slider"
              type="range"
              min="2"
              max="20"
              step="1"
              className="form-range"
              value={localSettings.topK || 8}
              onChange={e => handleChange('topK', Number(e.target.value))}
            />
            <span className="form-hint">Number of dense + sparse chunks fused via Reciprocal Rank Fusion (RRF).</span>
          </div>

          {/* Actions */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              {saved ? (
                <>
                  <CheckCircle2 size={14} /> Saved!
                </>
              ) : (
                <>
                  <Save size={14} /> Save Configuration
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
