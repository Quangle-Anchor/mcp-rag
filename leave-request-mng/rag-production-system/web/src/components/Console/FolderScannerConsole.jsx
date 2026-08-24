import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderSearch, Folder, RefreshCw, Layers, Code2,
  FileText, CheckCircle2, AlertCircle, Loader2,
  ChevronRight, HardDrive, FileCode, Search, Terminal,
  Activity, ArrowUpRight
} from 'lucide-react';
import { api } from '../../services/api';

const FolderScannerConsole = ({ namespace, setNamespace, settings }) => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
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
        // Pick current namespace match or first folder
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
    setFileSearch('');
    if (setNamespace) {
      setNamespace(folderName);
    }
  };

  const currentFolder = useMemo(() => {
    return folders.find(f => f.name === selectedFolder) || {
      name: selectedFolder,
      path: `.../${selectedFolder}`,
      total_files: 0,
      doc_files_count: 0,
      code_files_count: 0,
      languages: [],
      files: [],
    };
  }, [folders, selectedFolder]);

  const filteredFiles = useMemo(() => {
    if (!currentFolder.files) return [];
    if (!fileSearch.trim()) return currentFolder.files;
    const q = fileSearch.toLowerCase();
    return currentFolder.files.filter(f =>
      f.name.toLowerCase().includes(q) || f.rel_path.toLowerCase().includes(q)
    );
  }, [currentFolder.files, fileSearch]);

  // ── Button 1: --sync (Sync Documents) ──────────────────────────────────────
  const handleSync = async () => {
    if (!selectedFolder || syncing || scanning) return;
    const targetNs = selectedFolder;
    setSyncing(true);
    setActionReceipt({
      type: 'info',
      title: 'Syncing Documents (--sync)',
      message: `Extracting and chunking Markdown & YAML files from "${selectedFolder}" into namespace "${targetNs}"…`,
    });

    try {
      const res = await api.syncDirect(targetNs, selectedFolder);
      const elapsed = (res.elapsed_ms / 1000).toFixed(1);
      setActionReceipt({
        type: 'success',
        title: 'Sync Succeeded (--sync)',
        message: `Successfully indexed ${res.chunks_synced} chunks from "${selectedFolder}" into Pinecone namespace "${res.namespace}".`,
        details: `Execution time: ${elapsed}s | Target namespace: ${res.namespace}`,
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
  const handleScanCode = async () => {
    if (!selectedFolder || syncing || scanning) return;
    const targetNs = selectedFolder;
    setScanning(true);
    setActionReceipt({
      type: 'info',
      title: 'Scanning Source Code (--scan-code)',
      message: `Executing language-aware AST chunking on "${selectedFolder}" into namespace "${targetNs}"…`,
    });

    try {
      const res = await api.scanCode(selectedFolder, targetNs);
      const langs = res.languages?.length ? res.languages.join(', ') : 'markdown';
      setActionReceipt({
        type: 'success',
        title: 'Code Scan Succeeded (--scan-code)',
        message: `Scanned ${res.files_scanned} source files → ${res.chunks_created} chunks into Pinecone namespace "${res.namespace}".`,
        details: `Languages: ${langs} | Target namespace: ${res.namespace}`,
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
    <div className="console-container">
      {/* Console Header */}
      <div className="console-header">
        <div className="console-header-left">
          <div className="console-icon-wrap">
            <FolderSearch size={18} color="var(--accent-light)" />
          </div>
          <div>
            <h2 className="console-title">Sibling Folder Scanner</h2>
            <p className="console-subtitle">Discovers directories at the same level as the RAG tool</p>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={fetchFolders}
          disabled={loading || syncing || scanning}
          title="Re-scan workspace directories"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Main Console Content */}
      <div className="console-body">
        {/* Step 1: Directory Selection Grid */}
        <section className="console-section">
          <div className="section-title-row">
            <span className="section-label">1. Select Sibling Folder</span>
            <span className="section-counter">{folders.length} discovered</span>
          </div>

          {loading ? (
            <div className="state-box">
              <Loader2 size={16} className="animate-spin" />
              <span>Scanning parent directory for sibling folders…</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="state-box">
              <Folder size={16} />
              <span>No sibling directories found at tool level</span>
            </div>
          ) : (
            <div className="folder-grid">
              {folders.map(f => {
                const isSelected = f.name === selectedFolder;
                return (
                  <button
                    key={f.name}
                    type="button"
                    className={`folder-card ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectFolder(f.name)}
                  >
                    <div className="folder-card-icon">
                      <Folder size={18} />
                    </div>
                    <div className="folder-card-content">
                      <div className="folder-card-name">{f.name}</div>
                      <div className="folder-card-meta">
                        {f.total_files > 0 ? `${f.total_files} files` : 'Sibling dir'}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="folder-card-check">
                        <CheckCircle2 size={14} color="var(--accent-light)" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Step 2: Selected Folder Details & File Explorer */}
        {selectedFolder && (
          <section className="console-section">
            <div className="section-title-row">
              <span className="section-label">2. Folder Metrics & Namespace</span>
              <span className="badge badge-emerald">Active Bind</span>
            </div>

            <div className="folder-detail-panel">
              <div className="detail-top-row">
                <div className="detail-ns-group">
                  <HardDrive size={15} color="var(--accent-light)" />
                  <span className="detail-ns-text">Target Namespace:</span>
                  <code className="detail-ns-code">{selectedFolder}</code>
                </div>

                <div className="detail-stat-pills">
                  {currentFolder.total_files > 0 && (
                    <span className="pill pill-default">
                      <FileText size={11} /> {currentFolder.total_files} files
                    </span>
                  )}
                  {currentFolder.doc_files_count > 0 && (
                    <span className="pill pill-doc">
                      <Layers size={11} /> {currentFolder.doc_files_count} docs (.md/.yaml)
                    </span>
                  )}
                  {currentFolder.code_files_count > 0 && (
                    <span className="pill pill-code">
                      <Code2 size={11} /> {currentFolder.code_files_count} code files
                    </span>
                  )}
                </div>
              </div>

              {/* Detected Languages */}
              {currentFolder.languages?.length > 0 && (
                <div className="languages-row">
                  <span className="lang-label">Detected:</span>
                  {currentFolder.languages.map(lang => (
                    <span key={lang} className="lang-tag">
                      {lang}
                    </span>
                  ))}
                </div>
              )}

              {/* File tree preview with filter */}
              {currentFolder.files?.length > 0 && (
                <div className="file-tree-container">
                  <div className="file-tree-header">
                    <span>Files in {selectedFolder} ({filteredFiles.length})</span>
                    <div className="file-search-wrap">
                      <Search size={12} />
                      <input
                        type="text"
                        className="file-search-input"
                        placeholder="Filter files…"
                        value={fileSearch}
                        onChange={e => setFileSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="file-tree-list">
                    {filteredFiles.map((file, idx) => (
                      <div key={idx} className="file-tree-row" title={file.rel_path}>
                        <div className="file-tree-left">
                          {file.is_doc ? (
                            <FileText size={13} color="#93c5fd" />
                          ) : file.is_code ? (
                            <FileCode size={13} color="#86efac" />
                          ) : (
                            <FileText size={13} color="var(--text-muted)" />
                          )}
                          <span className="file-name-text">{file.rel_path}</span>
                        </div>
                        <span className="file-size-text">
                          {(file.size_bytes / 1024).toFixed(1)} kb
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Step 3: Action Buttons */}
        <section className="console-section">
          <div className="section-title-row">
            <span className="section-label">3. Execution Actions</span>
            <span className="section-hint">Namespace: "{selectedFolder || 'docs'}"</span>
          </div>

          <div className="action-grid">
            {/* Button 1: --sync */}
            <button
              type="button"
              className="action-tile action-tile-sync"
              onClick={handleSync}
              disabled={!selectedFolder || syncing || scanning}
            >
              <div className="action-tile-header">
                <div className="action-tile-title">
                  {syncing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  <span>Sync Documents</span>
                </div>
                <span className="action-tag">--sync</span>
              </div>
              <p className="action-tile-desc">
                Parses Markdown & YAML docs from <strong>{selectedFolder || 'folder'}</strong> → Pinecone namespace <strong>"{selectedFolder || 'ns'}"</strong> & BM25 index.
              </p>
            </button>

            {/* Button 2: --scan-code */}
            <button
              type="button"
              className="action-tile action-tile-scan"
              onClick={handleScanCode}
              disabled={!selectedFolder || syncing || scanning}
            >
              <div className="action-tile-header">
                <div className="action-tile-title">
                  {scanning ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Code2 size={16} />
                  )}
                  <span>Scan Source Code</span>
                </div>
                <span className="action-tag">--scan-code</span>
              </div>
              <p className="action-tile-desc">
                Language-aware AST code chunking for <strong>{selectedFolder || 'folder'}</strong> → Pinecone namespace <strong>"{selectedFolder || 'ns'}"</strong> & BM25 index.
              </p>
            </button>
          </div>
        </section>

        {/* Execution Receipt Telemetry */}
        {actionReceipt && (
          <div className={`receipt-box ${actionReceipt.type}`}>
            <div className="receipt-icon">
              {actionReceipt.type === 'success' && <CheckCircle2 size={18} />}
              {actionReceipt.type === 'error' && <AlertCircle size={18} />}
              {actionReceipt.type === 'info' && <Loader2 size={18} className="animate-spin" />}
            </div>
            <div className="receipt-content">
              <div className="receipt-title">{actionReceipt.title}</div>
              <div className="receipt-message">{actionReceipt.message}</div>
              {actionReceipt.details && (
                <div className="receipt-details">{actionReceipt.details}</div>
              )}
            </div>
            {actionReceipt.timestamp && (
              <span className="receipt-timestamp">{actionReceipt.timestamp}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderScannerConsole;
