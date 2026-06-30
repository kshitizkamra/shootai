import React, { useState, useEffect } from 'react';
import { getHistory, deleteHistoryEntry } from '../utils/storage';

const WORKFLOW_LABELS = { A: 'Change Background', B: 'Change Model', C: 'Full PDP Shoot', D: 'Virtual Try-On' };
const WORKFLOW_ICONS  = { A: '🌅', B: '👤', C: '📸', D: '👗' };

export default function History() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterWorkflow, setFilterWorkflow] = useState('all');
  const [filterDate, setFilterDate] = useState('all');

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

  async function handleRedownload(entry) {
    if (!entry.outputPath) return alert('Output file path not found.');
    const exists = await window.electronAPI.fileExists(entry.outputPath);
    if (!exists) return alert('File no longer exists on disk.');
    window.electronAPI.openInExplorer(entry.outputPath);
  }

  // Filter
  const now = new Date();
  const filtered = history.filter(entry => {
    if (filterWorkflow !== 'all' && entry.workflow !== filterWorkflow) return false;
    if (filterDate !== 'all') {
      const created = new Date(entry.createdAt);
      const diffDays = (now - created) / (1000 * 60 * 60 * 24);
      if (filterDate === 'today' && diffDays > 1) return false;
      if (filterDate === 'week' && diffDays > 7) return false;
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
            <div className="empty-state-desc">{history.length === 0 ? 'Generated images will appear here after you approve them' : 'Try a different filter'}</div>
          </div>
        ) : (
          filtered.map(entry => (
            <HistoryItem
              key={entry.id}
              entry={entry}
              onDelete={() => handleDelete(entry)}
              onRedownload={() => handleRedownload(entry)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function HistoryItem({ entry, onDelete, onRedownload }) {
  const [imgError, setImgError] = useState(false);
  const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';

  return (
    <div className="history-item">
      {/* Thumbnail */}
      {entry.outputPath && !imgError ? (
        <img
          src={`file://${entry.outputPath}`}
          alt=""
          className="history-thumb"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="history-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
          {WORKFLOW_ICONS[entry.workflow] || '📸'}
        </div>
      )}

      {/* Info */}
      <div className="history-info">
        <div className="history-name">{entry.productName || 'Unnamed'} — {entry.shotType || ''}</div>
        <div className="history-meta">
          {WORKFLOW_ICONS[entry.workflow]} {WORKFLOW_LABELS[entry.workflow] || 'Unknown'} · {date}
        </div>
        {entry.outputPath && (
          <div className="history-meta" style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>
            {entry.outputPath}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={onRedownload} title="Show in folder">📁</button>
        <button className="btn btn-danger btn-sm" onClick={onDelete} title="Delete entry">🗑</button>
      </div>
    </div>
  );
}
