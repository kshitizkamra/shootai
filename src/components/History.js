import React, { useState, useEffect } from 'react';
import { getHistory, deleteHistoryEntry } from '../utils/storage';

const WORKFLOW_LABELS = {
  A: 'Change Background', B: 'Change Model',
  C: 'Full PDP Shoot', D: 'Virtual Try-On',
  E: 'PDP Shoot E', Batch: 'Batch',
};
const WORKFLOW_ICONS = {
  A: '🌅', B: '👤', C: '📸', D: '👗', E: '📦', Batch: '📦',
};

export default function History() {
  const [history, setHistory]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterWorkflow, setFilterWorkflow] = useState('all');
  const [filterDate, setFilterDate]   = useState('all');
  const [lightbox, setLightbox]       = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setHistory(await getHistory());
    setLoading(false);
  }

  async function handleDelete(entry) {
    if (!window.confirm('Delete this history entry?')) return;
    setHistory(await deleteHistoryEntry(entry.id));
  }

  function handleDownload(entry) {
    const src = entry.imageData || entry.outputPath;
    if (!src) return alert('No image data found.');
    const a = document.createElement('a');
    a.href = src;
    a.download = `${entry.label || entry.productName || 'image'}.png`;
    a.click();
  }

  const now = new Date();
  const filtered = history.filter(entry => {
    if (filterWorkflow !== 'all' && entry.workflow !== filterWorkflow) return false;
    if (filterDate !== 'all') {
      const created = new Date(entry.createdAt);
      const diffDays = (now - created) / (1000 * 60 * 60 * 24);
      if (filterDate === 'today' && diffDays > 1) return false;
      if (filterDate === 'week'  && diffDays > 7) return false;
      if (filterDate === 'month' && diffDays > 30) return false;
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>History</h1>
            <p>All previous generations — {history.length} total</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <select className="form-select" style={{ width: 170 }} value={filterWorkflow} onChange={e => setFilterWorkflow(e.target.value)}>
              <option value="all">All Workflows</option>
              <option value="A">Change Background</option>
              <option value="B">Change Model</option>
              <option value="C">Full PDP Shoot</option>
              <option value="D">Virtual Try-On</option>
              <option value="E">PDP Shoot E</option>
              <option value="Batch">Batch</option>
            </select>
            <select className="form-select" style={{ width: 130 }} value={filterDate} onChange={e => setFilterDate(e.target.value)}>
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>
        </div>
      </div>

      <div className="screen-body">
        {loading ? (
          <div className="generating-overlay"><div className="spinner spinner-dark" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">📋</span>
            <div className="empty-state-title">{history.length === 0 ? 'No history yet' : 'No results for this filter'}</div>
            <div className="empty-state-desc">{history.length === 0 ? 'Generated images will appear here' : 'Try a different filter'}</div>
          </div>
        ) : (
          filtered.map(entry => (
            <HistoryItem
              key={entry.id}
              entry={entry}
              onDelete={() => handleDelete(entry)}
              onDownload={() => handleDownload(entry)}
              onView={() => setLightbox(entry)}
            />
          ))
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out',
          }}
        >
          <img
            src={lightbox.imageData || lightbox.outputPath}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, cursor: 'default' }}
          />
        </div>
      )}
    </div>
  );
}

function HistoryItem({ entry, onDelete, onDownload, onView }) {
  const date  = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
  const src   = entry.imageData || (entry.outputPath ? `file://${entry.outputPath}` : null);
  const name  = entry.label || entry.productName || 'Unnamed';
  const shot  = entry.shotType || (entry.meta?.background ? entry.meta.background : '');
  const wIcon = WORKFLOW_ICONS[entry.workflow]  || '📸';
  const wLabel= WORKFLOW_LABELS[entry.workflow] || entry.workflow || 'Unknown';

  return (
    <div className="history-item">
      {/* Thumbnail */}
      <div
        onClick={src ? onView : undefined}
        style={{
          width: 72, height: 72, flexShrink: 0, borderRadius: 8,
          overflow: 'hidden', background: 'var(--gray-100)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: src ? 'zoom-in' : 'default',
        }}
      >
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 24 }}>{wIcon}</span>
        )}
      </div>

      {/* Info */}
      <div className="history-info">
        <div className="history-name">{name}{shot ? ` — ${shot}` : ''}</div>
        <div className="history-meta">{wIcon} {wLabel} · {date}</div>
        {entry.meta?.model && (
          <div className="history-meta" style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>
            {entry.meta.model}{entry.meta.pose && entry.meta.pose !== 'None' ? ` · ${entry.meta.pose}` : ''}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {src && <button className="btn btn-ghost btn-sm" onClick={onView} title="View">👁</button>}
        {src && <button className="btn btn-ghost btn-sm" onClick={onDownload} title="Download">⬇</button>}
        <button className="btn btn-danger btn-sm" onClick={onDelete} title="Delete">🗑</button>
      </div>
    </div>
  );
}
