import React, { useState } from 'react';
import {
  SquareStack, Settings, Layers, RefreshCw, Info
} from 'lucide-react';
import { api } from '../../services/api';

const Sidebar = ({ namespace, setNamespace, settings, onOpenSettings }) => {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResultType, setSyncResultType] = useState('info');

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncStatus('Queued…');
      setSyncResultType('info');
      const res = await api.sync(namespace, settings?.apiBaseUrl);
      const interval = setInterval(async () => {
        try {
          const s = await api.getTaskStatus(res.task_id, settings?.apiBaseUrl);
          if (s.status === 'completed') {
            setSyncStatus(`✓ ${s.chunks_created ?? ''} chunks indexed.`);
            setSyncResultType('success');
            clearInterval(interval);
            setTimeout(() => setSyncing(false), 3000);
          } else if (s.status === 'failed') {
            setSyncStatus('✗ Sync failed.');
            setSyncResultType('error');
            clearInterval(interval);
            setTimeout(() => setSyncing(false), 4000);
          } else {
            setSyncStatus('Processing…');
          }
        } catch {
          clearInterval(interval);
          setSyncing(false);
        }
      }, 2000);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setSyncStatus(`Error: ${detail}`);
      setSyncResultType('error');
      setSyncing(false);
    }
  };

  const hasKeys = Boolean(settings?.googleApiKey) && Boolean(settings?.pineconeApiKey || settings?.vectorBackend !== 'pinecone');

  return (
    <div className="sidebar">
      {/* Brand */}
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

      {/* Body */}
      <div className="sidebar-body">
        {/* Namespace */}
        <div className="section-card">
          <div className="section-card-header">
            <Layers size={13} /> Documents
          </div>
          <div className="section-card-body">
            <div className="input-group">
              <label className="input-label" htmlFor="sb-namespace">Namespace</label>
              <input
                id="sb-namespace"
                type="text"
                className="input-field"
                value={namespace}
                onChange={e => setNamespace(e.target.value)}
                placeholder="e.g. docs"
              />
            </div>

            <button
              className={`btn btn-block ${syncing ? '' : 'btn-primary'}`}
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? (syncStatus || 'Syncing…') : 'Sync Documents'}
            </button>

            {syncStatus && !syncing && (
              <div className={`result-box ${syncResultType}`}>{syncStatus}</div>
            )}

            <p className="info-row" style={{ justifyContent: 'center' }}>
              <Info size={11} />
              Re-indexes .md / .yaml → Pinecone + BM25
            </p>
          </div>
        </div>

        {/* Settings link */}
        <button
          className="btn btn-block"
          onClick={onOpenSettings}
          style={{ marginTop: 'auto' }}
        >
          <Settings size={14} /> Settings
        </button>
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className={`status-dot ${hasKeys ? 'animate-pulse-glow' : 'offline'}`} />
        <span>{hasKeys ? 'Keys configured' : 'Missing API keys'}</span>
      </div>
    </div>
  );
};

export default Sidebar;
