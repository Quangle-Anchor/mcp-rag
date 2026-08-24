import React from 'react';
import { Database, Sparkles, Activity } from 'lucide-react';
import FolderScannerWidget from './FolderScannerWidget';

const FunctionPanel = ({ namespace, setNamespace, settings }) => {
  return (
    <div className="function-panel">
      {/* Header */}
      <div className="function-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Database size={18} color="var(--accent-light)" />
          <span className="function-panel-title">Embedding & Ingestion Pipeline</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}>
            <Activity size={10} style={{ marginRight: 4 }} />
            Active NS: {namespace || 'docs'}
          </span>
        </div>
      </div>

      {/* Main Body */}
      <div className="function-panel-body">
        {/* Sibling Folder Scanner Widget with --sync and --scan-code actions */}
        <FolderScannerWidget
          namespace={namespace}
          setNamespace={setNamespace}
          settings={settings}
        />
      </div>
    </div>
  );
};

export default FunctionPanel;
