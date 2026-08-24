import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderSearch, Folder, RefreshCw, Layers, Code2,
  FileText, CheckCircle2, AlertCircle, Loader2,
  ChevronRight, HardDrive, FileCode
} from 'lucide-react';
import { api } from '../../services/api';

const FolderScannerWidget = ({ namespace, setNamespace, settings }) => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [actionReceipt, setActionReceipt] = useState(null);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setActionReceipt(null);
    try {
      let list = [];
      try {
        list = await api.listFolderDetails();
      } catch {
        const simpleList = await api.listCodeFolders();
        list = (simpleList || []).map(name => ({
          name,
          path: `.../${name}`,
          total_files: 0,
          doc_files_count: 0,
          code_files_count: 0,
          languages: [],
          files: [],
        }));
      }

      setFolders(list || []);

      if (list && list.length > 0) {
        // If current namespace matches one of the folders, pick that; otherwise default to first
        const match = list.find(f => f.name === namespace);
        const target = match ? match.name : list[0].name;
        setSelectedFolder(target);
        if (setNamespace && (!namespace || namespace === 'docs')) {
          setNamespace(target);
        }
      }
    } catch (err) {
      console.error('Failed to load sibling folders:', err);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [namespace, setNamespace]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleSelectFolder = (folderName) => {
    setSelectedFolder(folderName);
    setActionReceipt(null);
    if (setNamespace) {
      setNamespace(folderName);
    }
  };

  const currentFolderData = folders.find(f => f.name === selectedFolder) || {
    name: selectedFolder,
    path: `.../${selectedFolder}`,
    total_files: 0,
    doc_files_count: 0,
    code_files_count: 0,
    languages: [],
    files: [],
  };

  // ── Button 1: --sync (Sync Documents) ──────────────────────────────────────
  const handleSyncAction = async () => {
    if (!selectedFolder || syncing || scanning) return;
    const targetNs = selectedFolder;
    setSyncing(true);
    setActionReceipt({
      type: 'info',
      title: 'Sync in Progress',
      message: `Syncing documentation from "${selectedFolder}" into Pinecone namespace "${targetNs}"…`,
    });

    try {
      const res = await api.syncDirect(targetNs, selectedFolder);
      const elapsedSec = (res.elapsed_ms / 1000).toFixed(1);
      setActionReceipt({
        type: 'success',
        title: 'Sync Complete (--sync)',
        message: `Successfully indexed ${res.chunks_synced} chunks from "${selectedFolder}" into namespace "${res.namespace}".`,
        details: `Elapsed: ${elapsedSec}s | Target: ${res.namespace}`,
        timestamp: new Date().toLocaleTimeString(),
      });
      if (setNamespace) setNamespace(targetNs);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Sync failed';
      setActionReceipt({
        type: 'error',
        title: 'Sync Failed (--sync)',
        message: detail,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setSyncing(false);
    }
  };

  // ── Button 2: --scan-code (Scan Source Code) ───────────────────────────────
  const handleScanCodeAction = async () => {
    if (!selectedFolder || syncing || scanning) return;
    const targetNs = selectedFolder;
    setScanning(true);
    setActionReceipt({
      type: 'info',
      title: 'Code Scan in Progress',
      message: `Scanning source code from "${selectedFolder}" with language-aware separators into Pinecone namespace "${targetNs}"…`,
    });

    try {
      const res = await api.scanCode(selectedFolder, targetNs);
      const langs = res.languages?.length ? res.languages.join(', ') : 'unknown';
      setActionReceipt({
        type: 'success',
        title: 'Code Scan Complete (--scan-code)',
        message: `Scanned ${res.files_scanned} files → ${res.chunks_created} chunks into namespace "${res.namespace}".`,
        details: `Languages: ${langs} | Target: ${res.namespace}`,
        timestamp: new Date().toLocaleTimeString(),
      });
      if (setNamespace) setNamespace(targetNs);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Code scan failed';
      setActionReceipt({
        type: 'error',
        title: 'Code Scan Failed (--scan-code)',
        message: detail,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="folder-scanner-widget">
      {/* Header */}
      <div className="folder-scanner-header">
        <div className="folder-scanner-header-left">
          <FolderSearch size={18} color="var(--accent-light)" />
          <span className="folder-scanner-header-title">
            Sibling Folder Scanner
          </span>
          <span className="badge badge-emerald" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
            Sibling Workspace
          </span>
        </div>

        <button
          className="btn btn-xs btn-icon"
          onClick={fetchFolders}
          disabled={loading || syncing || scanning}
          title="Re-scan sibling folders"
          style={{ color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="folder-scanner-body">
        {/* Sibling folders chips */}
        <div className="folder-chips-container">
          <div className="folder-chips-label">
            <span>Discovered Directories</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{folders.length} folder{folders.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="doc-listing-loading">
              <Loader2 size={14} className="animate-spin" />
              <span>Scanning parent directory for sibling folders…</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="doc-listing-loading" style={{ color: 'var(--text-muted)' }}>
              <Folder size={14} />
              <span>No sibling folders found at tool level</span>
            </div>
          ) : (
            <div className="folder-chips-grid">
              {folders.map(f => {
                const isSelected = f.name === selectedFolder;
                return (
                  <button
                    key={f.name}
                    type="button"
                    className={`folder-chip-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectFolder(f.name)}
                  >
                    <div className="folder-chip-icon">
                      <Folder size={16} />
                    </div>
                    <div className="folder-chip-text">
                      <div className="folder-chip-name">{f.name}</div>
                      <div className="folder-chip-meta" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {f.total_files > 0 ? `${f.total_files} files` : 'Sibling dir'}
                      </div>
                    </div>
                    {isSelected && (
                      <ChevronRight size={14} color="var(--accent-light)" style={{ flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Folder Metadata Card */}
        {selectedFolder && (
          <div className="folder-details-card">
            <div className="folder-details-top">
              <div className="folder-namespace-banner">
                <HardDrive size={14} />
                <span>Namespace Bound:</span>
                <span className="folder-namespace-badge">{selectedFolder}</span>
              </div>

              <div className="folder-stats-badges">
                {currentFolderData.total_files > 0 && (
                  <span className="stat-pill">
                    <FileText size={11} /> {currentFolderData.total_files} total files
                  </span>
                )}
                {currentFolderData.doc_files_count > 0 && (
                  <span className="stat-pill doc">
                    <Layers size={11} /> {currentFolderData.doc_files_count} docs (.md/.yaml)
                  </span>
                )}
                {currentFolderData.code_files_count > 0 && (
                  <span className="stat-pill code">
                    <Code2 size={11} /> {currentFolderData.code_files_count} code files
                  </span>
                )}
              </div>
            </div>

            {/* Language tags if detected */}
            {currentFolderData.languages?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Detected:</span>
                {currentFolderData.languages.map(lang => (
                  <span
                    key={lang}
                    className="badge badge-blue"
                    style={{ fontSize: '0.65rem', padding: '1px 6px' }}
                  >
                    {lang}
                  </span>
                ))}
              </div>
            )}

            {/* File list preview */}
            {currentFolderData.files?.length > 0 && (
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Files Preview ({currentFolderData.files.length}):
                </div>
                <div className="folder-file-preview">
                  {currentFolderData.files.map((file, idx) => (
                    <div key={idx} className="folder-file-item" title={file.rel_path}>
                      <div className="folder-file-item-left">
                        {file.is_doc ? (
                          <FileText size={12} color="#93c5fd" />
                        ) : file.is_code ? (
                          <FileCode size={12} color="#86efac" />
                        ) : (
                          <FileText size={12} color="var(--text-muted)" />
                        )}
                        <span>{file.rel_path}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {(file.size_bytes / 1024).toFixed(1)} kb
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons: --sync and --scan-code */}
        <div className="action-buttons-container">
          {/* Button 1: --sync */}
          <button
            type="button"
            className="action-card-btn btn-sync-action"
            onClick={handleSyncAction}
            disabled={!selectedFolder || syncing || scanning}
          >
            <div className="action-card-btn-header">
              <span className="action-card-btn-title">
                {syncing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Sync Documents
              </span>
              <span className="action-badge-tag">--sync</span>
            </div>
            <p className="action-card-btn-desc">
              Parse Markdown & YAML files in <strong>{selectedFolder || 'folder'}</strong> → Pinecone namespace <strong>"{selectedFolder || 'ns'}"</strong> + BM25 index.
            </p>
          </button>

          {/* Button 2: --scan-code */}
          <button
            type="button"
            className="action-card-btn btn-scan-action"
            onClick={handleScanCodeAction}
            disabled={!selectedFolder || syncing || scanning}
          >
            <div className="action-card-btn-header">
              <span className="action-card-btn-title">
                {scanning ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Code2 size={16} />
                )}
                Scan Source Code
              </span>
              <span className="action-badge-tag">--scan-code</span>
            </div>
            <p className="action-card-btn-desc">
              Language-aware AST code chunking for <strong>{selectedFolder || 'folder'}</strong> → Pinecone namespace <strong>"{selectedFolder || 'ns'}"</strong> + BM25 index.
            </p>
          </button>
        </div>

        {/* Execution Receipt Display */}
        {actionReceipt && (
          <div className={`execution-receipt ${actionReceipt.type}`}>
            {actionReceipt.type === 'success' && <CheckCircle2 size={18} style={{ flexShrink: 0 }} />}
            {actionReceipt.type === 'error' && <AlertCircle size={18} style={{ flexShrink: 0 }} />}
            {actionReceipt.type === 'info' && <Loader2 size={18} className="animate-spin" style={{ flexShrink: 0 }} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{actionReceipt.title}</div>
              <div>{actionReceipt.message}</div>
              {actionReceipt.details && (
                <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  {actionReceipt.details}
                </div>
              )}
            </div>
            {actionReceipt.timestamp && (
              <span style={{ fontSize: '0.68rem', opacity: 0.7, alignSelf: 'flex-start' }}>
                {actionReceipt.timestamp}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderScannerWidget;
