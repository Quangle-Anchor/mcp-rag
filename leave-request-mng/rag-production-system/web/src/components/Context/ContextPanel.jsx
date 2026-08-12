import React from 'react';
import { X, FileText, Activity, Hash, ChevronRight } from 'lucide-react';

// Score bar component
function ScoreBar({ score }) {
  const pct = Math.min(100, Math.max(0, score * 100));
  const color = score >= 0.7 ? 'var(--green)' : score >= 0.4 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1,
        height: 3,
        borderRadius: 99,
        background: 'rgba(255,255,255,0.07)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: 99,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color, minWidth: 36, textAlign: 'right', fontWeight: 600 }}>
        {score.toFixed(3)}
      </span>
    </div>
  );
}

const ContextPanel = ({ chunks, isOpen, onClose }) => {
  return (
    <div className={`context-panel ${isOpen ? 'open' : ''}`}>
      {/* Header */}
      <div className="context-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} color="var(--accent-light)" />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Retrieved Context</span>
          {chunks.length > 0 && (
            <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
              {chunks.length}
            </span>
          )}
        </div>
        <button className="btn btn-icon btn-sm" onClick={onClose} title="Close panel">
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="context-panel-body">
        {chunks.length === 0 ? (
          <div className="empty-state">
            <Activity size={32} style={{ margin: '0 auto 12px', display: 'block', color: 'var(--text-muted)' }} />
            <p>No context retrieved yet.</p>
            <p style={{ fontSize: '0.8rem', marginTop: 6, color: 'var(--text-muted)' }}>
              Send a query to see retrieved chunks here.
            </p>
          </div>
        ) : (
          chunks.map((chunk, idx) => (
            <div key={chunk.chunk_id || idx} className="chunk-card">
              {/* Chunk header */}
              <div className="chunk-header">
                <div className="chunk-file">
                  <FileText size={12} />
                  <span title={chunk.document_name}>{chunk.document_name}</span>
                </div>
                <span className="badge badge-purple" style={{ fontSize: '0.65rem', flexShrink: 0 }}>
                  #{idx + 1}
                </span>
              </div>

              {/* Score bar */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Relevance Score</span>
                </div>
                <ScoreBar score={chunk.score} />
              </div>

              {/* Metadata row */}
              {(chunk.chunk_id || chunk.namespace) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {chunk.namespace && (
                    <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                      <Hash size={9} /> {chunk.namespace}
                    </span>
                  )}
                  {chunk.chunk_id && (
                    <span className="badge badge-purple" style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
                      {String(chunk.chunk_id).slice(0, 12)}…
                    </span>
                  )}
                </div>
              )}

              {/* Content snippet */}
              <div className="chunk-content">{chunk.snippet}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ContextPanel;
