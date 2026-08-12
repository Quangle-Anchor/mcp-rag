import React, { useState, useCallback } from 'react';
import {
  KeyRound, Database, Sliders, Eye, EyeOff, ChevronDown,
  Info, ExternalLink, Server, Cpu, Zap, Save, Check,
  ArrowLeft, SquareStack
} from 'lucide-react';

// ─── Reusable form components ────────────────────────────────────────────────

function KeyInput({ id, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="key-input-wrap">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className="input-field"
        value={value}
        onChange={onChange}
        placeholder={placeholder || '••••••••••••••••••••••'}
        autoComplete="off"
        spellCheck={false}
      />
      <button className="key-toggle-btn" onClick={() => setShow(s => !s)} type="button">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function RangeField({ label, id, min, max, step = 1, value, onChange, hint }) {
  return (
    <div className="input-group">
      <label className="input-label" htmlFor={id}>{label}</label>
      <div className="range-row">
        <input id={id} type="range" className="range-input"
          min={min} max={max} step={step} value={value} onChange={onChange} />
        <span className="range-value">{value}</span>
      </div>
      {hint && <p className="info-row"><Info size={11} />{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <div>
      <div className="toggle-row">
        <span className="toggle-label">{label}</span>
        <label className="toggle">
          <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
          <span className="toggle-track" />
        </label>
      </div>
      {hint && <p className="info-row" style={{ marginTop: 4 }}><Info size={11} />{hint}</p>}
    </div>
  );
}

function SelectField({ label, id, value, onChange, options, hint }) {
  return (
    <div className="input-group">
      <label className="input-label" htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <select id={id} className="input-field" value={value} onChange={onChange}
          style={{ paddingRight: 32, cursor: 'pointer' }}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} style={{
          position: 'absolute', right: 10, top: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)',
        }} />
      </div>
      {hint && <p className="info-row"><Info size={11} />{hint}</p>}
    </div>
  );
}

// ─── Section: Keys ───────────────────────────────────────────────────────────

function KeysSection({ settings, onChange }) {
  return (
    <div className="settings-column">
      <div className="section-card">
        <div className="section-card-header"><KeyRound size={13} /> LLM Provider</div>
        <div className="section-card-body">
          <SelectField
            label="Provider" id="llm-provider"
            value={settings.llmProvider}
            onChange={e => onChange('llmProvider', e.target.value)}
            options={[
              { value: 'google', label: 'Google Gemini' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
          {settings.llmProvider === 'google' && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="google-key">Google API Key</label>
                <KeyInput id="google-key" value={settings.googleApiKey}
                  onChange={e => onChange('googleApiKey', e.target.value)} placeholder="AIza…" />
                <p className="info-row">
                  <Info size={11} /> Used for Gemini LLM & embeddings.{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer"
                    style={{ color: 'var(--accent-light)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    Get key <ExternalLink size={10} />
                  </a>
                </p>
              </div>
              <SelectField label="LLM Model" id="llm-model"
                value={settings.llmModel} onChange={e => onChange('llmModel', e.target.value)}
                options={[
                  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
                  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
                  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
                  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
                ]}
              />
              <SelectField label="Embedding Model" id="embed-model"
                value={settings.embeddingModel} onChange={e => onChange('embeddingModel', e.target.value)}
                options={[
                  { value: 'models/gemini-embedding-2', label: 'Gemini Embedding 2' },
                  { value: 'models/text-embedding-004', label: 'Text Embedding 004' },
                ]}
              />
            </>
          )}
          {settings.llmProvider === 'openai' && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="openai-key">OpenAI API Key</label>
                <KeyInput id="openai-key" value={settings.openaiApiKey}
                  onChange={e => onChange('openaiApiKey', e.target.value)} placeholder="sk-…" />
              </div>
              <SelectField label="LLM Model" id="openai-llm-model"
                value={settings.openaiLlmModel} onChange={e => onChange('openaiLlmModel', e.target.value)}
                options={[
                  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
                  { value: 'gpt-4o', label: 'GPT-4o' },
                  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                  { value: 'o3-mini', label: 'o3 Mini' },
                ]}
              />
              <SelectField label="Embedding Model" id="openai-embed-model"
                value={settings.openaiEmbedModel} onChange={e => onChange('openaiEmbedModel', e.target.value)}
                options={[
                  { value: 'text-embedding-3-small', label: 'text-embedding-3-small' },
                  { value: 'text-embedding-3-large', label: 'text-embedding-3-large' },
                ]}
              />
            </>
          )}
        </div>
      </div>

      <div className="section-card">
        <div className="section-card-header"><Database size={13} /> Vector Store</div>
        <div className="section-card-body">
          <SelectField label="Backend" id="vector-backend"
            value={settings.vectorBackend} onChange={e => onChange('vectorBackend', e.target.value)}
            options={[
              { value: 'pinecone', label: 'Pinecone' },
              { value: 'qdrant', label: 'Qdrant' },
              { value: 'chroma', label: 'ChromaDB (local)' },
            ]}
          />
          {settings.vectorBackend === 'pinecone' && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="pinecone-key">Pinecone API Key</label>
                <KeyInput id="pinecone-key" value={settings.pineconeApiKey}
                  onChange={e => onChange('pineconeApiKey', e.target.value)} placeholder="pcsk_…" />
                <p className="info-row">
                  <Info size={11} />
                  <a href="https://app.pinecone.io/organizations/-/projects/-/keys" target="_blank" rel="noreferrer"
                    style={{ color: 'var(--accent-light)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    Pinecone Console <ExternalLink size={10} />
                  </a>
                </p>
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="pinecone-index">Index Name</label>
                <input id="pinecone-index" type="text" className="input-field"
                  value={settings.pineconeIndex}
                  onChange={e => onChange('pineconeIndex', e.target.value)} placeholder="mendix-rag" />
              </div>
            </>
          )}
          {settings.vectorBackend === 'qdrant' && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="qdrant-url">Qdrant URL</label>
                <input id="qdrant-url" type="text" className="input-field"
                  value={settings.qdrantUrl} onChange={e => onChange('qdrantUrl', e.target.value)}
                  placeholder="http://localhost:6333" />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="qdrant-key">API Key (optional)</label>
                <KeyInput id="qdrant-key" value={settings.qdrantApiKey}
                  onChange={e => onChange('qdrantApiKey', e.target.value)} placeholder="leave blank for local" />
              </div>
            </>
          )}
          {settings.vectorBackend === 'chroma' && (
            <div className="input-group">
              <label className="input-label" htmlFor="chroma-dir">Persist Directory</label>
              <input id="chroma-dir" type="text" className="input-field"
                value={settings.chromaDir} onChange={e => onChange('chromaDir', e.target.value)}
                placeholder="./data/chroma_db" />
            </div>
          )}
        </div>
      </div>

      <div className="section-card">
        <div className="section-card-header"><Server size={13} /> Backend API</div>
        <div className="section-card-body">
          <div className="input-group">
            <label className="input-label" htmlFor="api-base">API Base URL</label>
            <input id="api-base" type="text" className="input-field"
              value={settings.apiBaseUrl} onChange={e => onChange('apiBaseUrl', e.target.value)}
              placeholder="http://localhost:8000/api/v1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Tuning ─────────────────────────────────────────────────────────

function TuningSection({ settings, onChange }) {
  return (
    <div className="settings-column">
      <div className="section-card">
        <div className="section-card-header"><Cpu size={13} /> Chunking</div>
        <div className="section-card-body">
          <RangeField label="Chunk Size" id="chunk-size" min={128} max={4096} step={64}
            value={settings.chunkSize} onChange={e => onChange('chunkSize', Number(e.target.value))}
            hint="Target token count per chunk" />
          <RangeField label="Chunk Overlap" id="chunk-overlap" min={0} max={512} step={16}
            value={settings.chunkOverlap} onChange={e => onChange('chunkOverlap', Number(e.target.value))}
            hint="Overlap between adjacent chunks" />
          <RangeField label="Embed Batch Size" id="embed-batch" min={10} max={200} step={10}
            value={settings.embedBatchSize} onChange={e => onChange('embedBatchSize', Number(e.target.value))}
            hint="API calls per embedding batch" />
        </div>
      </div>

      <div className="section-card">
        <div className="section-card-header"><Sliders size={13} /> Hybrid Search (BM25 + Dense)</div>
        <div className="section-card-body">
          <RangeField label="Top-K Retrieval" id="top-k" min={1} max={20}
            value={settings.topK} onChange={e => onChange('topK', Number(e.target.value))}
            hint="Max chunks to retrieve per query" />
          <RangeField label="BM25 Weight" id="bm25-weight" min={0} max={1} step={0.05}
            value={settings.bm25Weight} onChange={e => onChange('bm25Weight', parseFloat(e.target.value))}
            hint={`Dense gets ${(1 - settings.bm25Weight).toFixed(2)}`} />
          <RangeField label="RRF-K Constant" id="rrf-k" min={20} max={120} step={5}
            value={settings.rrfK} onChange={e => onChange('rrfK', Number(e.target.value))}
            hint="Reciprocal rank fusion constant (default 60)" />
          <RangeField label="Keyword Boost" id="keyword-boost" min={0} max={50} step={0.5}
            value={settings.keywordBoost} onChange={e => onChange('keywordBoost', parseFloat(e.target.value))}
            hint="Extra score for exact ID matches" />
        </div>
      </div>

      <div className="section-card">
        <div className="section-card-header"><Zap size={13} /> Self-Reflection</div>
        <div className="section-card-body">
          <Toggle label="Enable Self-Reflection" checked={settings.enableSelfReflection}
            onChange={v => onChange('enableSelfReflection', v)}
            hint="Auto-retry with rewritten query if context is insufficient" />
          <RangeField label="Max Retrieval Attempts" id="max-attempts" min={1} max={3}
            value={settings.maxRetrievalAttempts}
            onChange={e => onChange('maxRetrievalAttempts', Number(e.target.value))}
            hint="1 original + N retries" />
          <RangeField label="Sufficient Chunk Threshold" id="chunk-threshold" min={1} max={10}
            value={settings.sufficientChunkThreshold}
            onChange={e => onChange('sufficientChunkThreshold', Number(e.target.value))}
            hint="Min chunks to consider retrieval successful" />
        </div>
      </div>
    </div>
  );
}

// ─── Default settings ────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  // BYOA — Keys (pre-filled from project .env)
  llmProvider:        'google',
  googleApiKey:       'AIzaSyCweIwAnWK_thY5MahzivETNQ3yYlLOvpQ',
  openaiApiKey:       '',
  llmModel:           'gemini-3.5-flash',
  openaiLlmModel:     'gpt-4o-mini',
  embeddingModel:     'models/gemini-embedding-2',
  openaiEmbedModel:   'text-embedding-3-small',

  // Vector DB (pre-filled from project .env)
  vectorBackend:      'pinecone',
  pineconeApiKey:     'pcsk_DDYJr_PSabQs2JGSEQkDY4D41JUxNtZm9SqxVNqiiZRHdPdENqvvr5W5jFtEkx1XX69vT',
  pineconeIndex:      'mendix-rag',
  qdrantUrl:          'http://localhost:6333',
  qdrantApiKey:       '',
  chromaDir:          './data/chroma_db',

  // Backend
  apiBaseUrl:         'http://localhost:8000/api/v1',

  // RAG Tuning
  namespace:          'docs',
  chunkSize:          900,
  chunkOverlap:       120,
  embedBatchSize:     50,
  topK:               8,
  bm25Weight:         0.4,
  rrfK:               60,
  keywordBoost:       10,
  enableSelfReflection:     true,
  maxRetrievalAttempts:     2,
  sufficientChunkThreshold: 2,
};

export const STORAGE_KEY = 'rag-ui-settings-v2';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

// ─── Full-page Settings ──────────────────────────────────────────────────────

const SettingsPage = ({ onBack, onSettingsChange }) => {
  const [settings, setSettings] = useState(() => loadSettings());
  const [saveToast, setSaveToast] = useState(false);

  const handleChange = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      onSettingsChange?.(settings);
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 2400);
    } catch { /* ignore */ }
  };

  return (
    <div className="settings-page">
      {/* Top bar */}
      <div className="settings-topbar">
        <button className="btn btn-sm" onClick={onBack}>
          <ArrowLeft size={15} /> Back to Chat
        </button>
        <div className="settings-topbar-center">
          <div className="sidebar-logo" style={{ width: 28, height: 28 }}>
            <SquareStack size={14} color="white" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>Settings</span>
          <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>BYOA</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>
          <Save size={14} /> Save Settings
        </button>
      </div>

      {/* Two-column grid */}
      <div className="settings-grid">
        <KeysSection settings={settings} onChange={handleChange} />
        <TuningSection settings={settings} onChange={handleChange} />
      </div>

      {/* Save toast */}
      {saveToast && (
        <div className="save-toast">
          <Check size={14} /> Settings saved
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
