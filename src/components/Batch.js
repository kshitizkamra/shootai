import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getBatchQueue, removeFromBatchQueue, clearBatchQueue, getBatchJobs, saveBatchJob, deleteBatchJob } from '../utils/batchQueue';
import { submitBatchJob, pollBatchJob, cancelBatchJob } from '../utils/api';
import { saveToOutput } from '../utils/fileHandler';
import { getResolution } from '../utils/constants';
import { addHistoryEntry } from '../utils/storage';

const WORKFLOW_LABELS = { A: '🌅 Background', B: '👤 Change Model', C: '📸 PDP Shoot', D: '👗 Try-On' };
const STATE_LABELS = {
  JOB_STATE_PENDING:   { label: 'Pending',   color: 'var(--gray-500)' },
  JOB_STATE_RUNNING:   { label: 'Running',   color: '#e07020' },
  JOB_STATE_SUCCEEDED: { label: 'Succeeded', color: 'var(--green)' },
  JOB_STATE_FAILED:    { label: 'Failed',    color: 'var(--red)' },
  JOB_STATE_CANCELLED: { label: 'Cancelled', color: 'var(--gray-500)' },
  JOB_STATE_CANCELLING:{ label: 'Cancelling',color: 'var(--gray-500)' },
};

export default function Batch() {
  const [tab, setTab] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [jobs, setJobs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState({});
  const [loadingImages, setLoadingImages] = useState({});
  const [lightbox, setLightbox] = useState(null); // { src, label }
  const hasActiveRef = useRef(false);
  const savedToHistoryRef = useRef(new Set());

  const loadQueue = useCallback(async () => {
    const q = await getBatchQueue();
    setQueue(q);
    // Auto-select any new items, keep existing selections, remove stale ones
    setSelectedItems(prev => {
      const next = new Set(prev);
      q.forEach(item => { if (!next.has(item.id)) next.add(item.id); });
      [...next].forEach(id => { if (!q.find(item => item.id === id)) next.delete(id); });
      return next;
    });
  }, []);

  const loadJobs = useCallback(async () => {
    const all = await getBatchJobs();
    // Strip base64 results from jobs that are fully saved to free memory
    const lean = all.map(j => {
      if (!j.results) return j;
      const allSaved = j.results.every((_, i) => j.savedPaths && j.savedPaths[i]);
      return allSaved ? { ...j, results: j.results.map(() => null) } : j;
    });
    setJobs(lean);
  }, []);

  useEffect(() => {
    loadQueue();
    loadJobs();
  }, [loadQueue, loadJobs]);

  // Keep hasActiveRef in sync with jobs state
  useEffect(() => {
    hasActiveRef.current = jobs.some(j => j.state === 'JOB_STATE_PENDING' || j.state === 'JOB_STATE_RUNNING');
  }, [jobs]);

  // Set up polling once on mount — never reset by jobs changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasActiveRef.current) pollAllJobs();
    }, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollAllJobs() {
    const current = await getBatchJobs();
    const active = current.filter(j => j.state === 'JOB_STATE_PENDING' || j.state === 'JOB_STATE_RUNNING');
    for (const job of active) {
      try {
        const updated = await pollBatchJob(job.name);
        const merged = { ...job, ...updated };
        // Auto-save results to History when job first succeeds
        if (updated.state === 'JOB_STATE_SUCCEEDED' && updated.results?.length) {
          const savedPaths = [...(job.savedPaths || [])];
          for (let i = 0; i < updated.results.length; i++) {
            const saveKey = `${job.name}_${i}`;
            if (updated.results[i] && !savedPaths[i] && !savedToHistoryRef.current.has(saveKey)) {
              savedToHistoryRef.current.add(saveKey);
              const label = job.itemLabels?.[i] || `batch_${i}`;
              const meta = job.itemMetas?.[i] || job.meta || {};
              try {
                await addHistoryEntry({ imageData: updated.results[i], label, workflow: 'Batch', meta });
                savedPaths[i] = 'history';
              } catch {}
            }
          }
          merged.savedPaths = savedPaths;
        }
        await saveBatchJob(merged);
      } catch (e) {
        console.warn('Poll failed for', job.name, e.message);
      }
    }
    loadJobs();
  }

  async function handleRemoveItem(id) {
    await removeFromBatchQueue(id);
    loadQueue();
  }

  async function handleClearQueue() {
    await clearBatchQueue();
    loadQueue();
  }

  async function handleSubmitBatch() {
    const selectedQueue = queue.filter(item => selectedItems.has(item.id));
    if (selectedQueue.length === 0) return setError('No items selected.');
    setSubmitting(true);
    setError('');
    try {
      const job = await submitBatchJob(selectedQueue);
      // Aggregate meta from queue items (take first non-null value for each field)
      const firstMeta = selectedQueue.find(q => q.meta)?.meta || {};
      const categories = [...new Set(selectedQueue.map(q => q.meta?.category).filter(Boolean))];
      const jobMeta = {
        model: firstMeta.model || null,
        background: firstMeta.background || null,
        categories: categories.length > 0 ? categories : null,
      };
      const newJob = {
        name: job.name,
        state: job.state,
        submittedAt: new Date().toISOString(),
        itemCount: selectedQueue.length,
        itemLabels: selectedQueue.map(q => q.label),
        resolutions: selectedQueue.map(q => q.resolution),
        itemMetas: selectedQueue.map(q => q.meta || {}),
        meta: jobMeta,
        results: null,
        savedPaths: [],
      };
      await saveBatchJob(newJob);
      // Remove only submitted items; keep unselected ones in queue
      for (const item of selectedQueue) await removeFromBatchQueue(item.id);
      await loadQueue();
      await loadJobs();
      setTab('jobs');
      // Poll once immediately after submit so first status check doesn't wait 30s
      setTimeout(() => pollAllJobs(), 3000);
    } catch (e) {
      setError('Submit failed: ' + e.message);
    }
    setSubmitting(false);
  }

  async function handlePollJob(name) {
    setError('');
    try {
      const job = jobs.find(j => j.name === name);
      const updated = await pollBatchJob(name);
      await saveBatchJob({ ...job, ...updated });
      loadJobs();
    } catch (e) {
      setError('Poll failed: ' + e.message);
    }
  }

  async function handleCancelJob(name) {
    try {
      await cancelBatchJob(name);
      const job = jobs.find(j => j.name === name);
      await saveBatchJob({ ...job, state: 'JOB_STATE_CANCELLED' });
      loadJobs();
    } catch (e) {
      setError('Cancel failed: ' + e.message);
    }
  }

  async function handleDeleteJob(name) {
    await deleteBatchJob(name);
    loadJobs();
  }

  async function handleSaveResult(jobIdx, resultIdx) {
    const job = jobs[jobIdx];
    if (!job?.results?.[resultIdx]) return;
    const key = `${jobIdx}_${resultIdx}`;
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      const label = (job.itemLabels && job.itemLabels[resultIdx]) || `batch_${resultIdx}`;
      const resolution = (job.resolutions && job.resolutions[resultIdx]) || '1080x1440';
      const res = getResolution(resolution);
      const cleanName = label.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = await saveToOutput(job.results[resultIdx], cleanName, 'batch', 'Batch', res);
      const updatedPaths = [...(job.savedPaths || [])];
      updatedPaths[resultIdx] = filePath;
      await saveBatchJob({ ...job, savedPaths: updatedPaths });
      loadJobs();
    } catch (e) {
      setError('Save failed: ' + e.message);
    }
    setSaving(prev => ({ ...prev, [key]: false }));
  }

  async function handleLoadImages(jobIdx) {
    const job = jobs[jobIdx];
    if (!job) return;
    setLoadingImages(prev => ({ ...prev, [jobIdx]: true }));
    try {
      const data = await pollBatchJob(job.name);
      if (data.results?.length) {
        const updated = { ...job, results: data.results };
        setJobs(prev => prev.map((j, i) => i === jobIdx ? updated : j));
      }
    } catch (e) {
      setError('Could not load images: ' + e.message);
    }
    setLoadingImages(prev => ({ ...prev, [jobIdx]: false }));
  }

  async function handleSaveAllResults(jobIdx) {
    const job = jobs[jobIdx];
    if (!job?.results) return;
    const updatedPaths = [...(job.savedPaths || [])];
    for (let i = 0; i < job.results.length; i++) {
      if (job.results[i] && !updatedPaths[i]) {
        const key = `${jobIdx}_${i}`;
        setSaving(prev => ({ ...prev, [key]: true }));
        try {
          const label = (job.itemLabels && job.itemLabels[i]) || `batch_${i}`;
          const resolution = (job.resolutions && job.resolutions[i]) || '1080x1440';
          const res = getResolution(resolution);
          const cleanName = label.replace(/[^a-zA-Z0-9_-]/g, '_');
          updatedPaths[i] = await saveToOutput(job.results[i], cleanName, 'batch', 'Batch', res);
        } catch (e) {
          setError('Save failed: ' + e.message);
        }
        setSaving(prev => ({ ...prev, [key]: false }));
      }
    }
    await saveBatchJob({ ...job, savedPaths: updatedPaths });
    loadJobs();
  }

  const activeCount = jobs.filter(j => j.state === 'JOB_STATE_PENDING' || j.state === 'JOB_STATE_RUNNING').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1>📦 Batch Processing</h1>
            <p>Queue multiple generations and submit them together — processed asynchronously in the background</p>
          </div>
          {activeCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, paddingTop: 6, flexShrink: 0 }}>
              <span className="spinner spinner-dark" style={{ width: 14, height: 14 }} />
              <span style={{ color: '#e07020' }}>{activeCount} job{activeCount > 1 ? 's' : ''} running</span>
              <button className="btn btn-ghost btn-sm" onClick={pollAllJobs}>↻ Check Now</button>
            </div>
          )}
          <div style={{ width: 140, flexShrink: 0 }} />
        </div>
      </div>

      <div className="screen-body">
        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {error}</div>}

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          <button className={`tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>
            Queue {queue.length > 0 && <span style={{ marginLeft: 4, background: 'var(--gold)', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{queue.length}</span>}
          </button>
          <button className={`tab ${tab === 'jobs' ? 'active' : ''}`} onClick={() => setTab('jobs')}>
            Jobs {activeCount > 0 && <span style={{ marginLeft: 4, background: '#e07020', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{activeCount}</span>}
          </button>
        </div>

        {/* ── Queue Tab ─────────────────────────────────────────────────────── */}
        {tab === 'queue' && (
          <div>
            {queue.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 300 }}>
                <span className="empty-state-icon">📦</span>
                <div style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>Queue is empty</div>
                <div className="empty-state-desc">Go to any workflow and click "📦 Batch" to add items instead of generating immediately.</div>
              </div>
            ) : (
              <>
                {/* Cost estimate */}
                {(() => {
                  const selectedQueue = queue.filter(item => selectedItems.has(item.id));
                  const selCount = selectedQueue.length;
                  return (
                    <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
                      🪙 <strong>{selCount} credit{selCount !== 1 ? 's' : ''}</strong> will be used for {selCount} selected item{selCount !== 1 ? 's' : ''}
                    </div>
                  );
                })()}

                {/* Select all / deselect all */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox"
                      checked={selectedItems.size === queue.length && queue.length > 0}
                      onChange={e => setSelectedItems(e.target.checked ? new Set(queue.map(i => i.id)) : new Set())} />
                    <span style={{ color: 'var(--gray-600)' }}>
                      {selectedItems.size === queue.length ? 'Deselect all' : `Select all (${queue.length})`}
                    </span>
                  </label>
                  <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                    {selectedItems.size} of {queue.length} selected
                  </span>
                </div>

                {/* Queue items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {queue.map((item) => {
                    const isSelected = selectedItems.has(item.id);
                    return (
                      <div key={item.id}
                        onClick={() => setSelectedItems(prev => { const n = new Set(prev); isSelected ? n.delete(item.id) : n.add(item.id); return n; })}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, background: isSelected ? 'var(--gray-50)' : '#f9f9f9', borderRadius: 8, padding: '10px 14px', border: `1px solid ${isSelected ? 'var(--gray-200)' : 'var(--gray-100)'}`, cursor: 'pointer', opacity: isSelected ? 1 : 0.5, transition: 'opacity 0.15s' }}>
                        <input type="checkbox" checked={isSelected}
                          onChange={e => { e.stopPropagation(); setSelectedItems(prev => { const n = new Set(prev); isSelected ? n.delete(item.id) : n.add(item.id); return n; }); }}
                          onClick={e => e.stopPropagation()}
                          style={{ cursor: 'pointer', width: 15, height: 15, flexShrink: 0 }} />
                        <span style={{ fontSize: 18 }}>{WORKFLOW_LABELS[item.workflow] || '✨'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)' }}>{item.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>
                            {item.images?.length || 0} img · {item.resolution} · {new Date(item.createdAt).toLocaleTimeString()}
                          </div>
                          {item.meta && (
                            <div style={{ fontSize: 10, color: 'var(--gray-600)', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {item.meta.model && <span>👤 {item.meta.model}</span>}
                              {item.meta.background && item.meta.background !== 'None' && <span>🖼 {item.meta.background}</span>}
                              {item.meta.pose && item.meta.pose !== 'None' && <span>🧍 {item.meta.pose}</span>}
                              {item.meta.globalInstruction && <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>💬 {item.meta.globalInstruction}</span>}
                              {item.meta.shotInstruction && <span style={{ color: '#888', fontStyle: 'italic' }}>📌 {item.meta.shotInstruction}</span>}
                            </div>
                          )}
                        </div>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', padding: '2px 8px' }}
                          onClick={e => { e.stopPropagation(); handleRemoveItem(item.id); }}>✕</button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-gold btn-lg" style={{ flex: 1 }} onClick={handleSubmitBatch} disabled={submitting || selectedItems.size === 0}>
                    {submitting ? <><span className="spinner" /> Submitting…</> : `🚀 Submit Batch (${selectedItems.size} selected)`}
                  </button>
                  <button className="btn btn-ghost" onClick={handleClearQueue} disabled={submitting}>Clear All</button>
                </div>

                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 10 }}>
                  Batch jobs process asynchronously — come back in 30–60 min and check the Jobs tab.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Jobs Tab ──────────────────────────────────────────────────────── */}
        {tab === 'jobs' && (
          <div>
            {jobs.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 300 }}>
                <span className="empty-state-icon">🚀</span>
                <div style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>No jobs yet</div>
                <div className="empty-state-desc">Submit a batch from the Queue tab to see jobs here.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {jobs.map((job, ji) => {
                  const stateInfo = STATE_LABELS[job.state] || { label: job.state, color: 'var(--gray-500)' };
                  const isActive = job.state === 'JOB_STATE_PENDING' || job.state === 'JOB_STATE_RUNNING';
                  const succeeded = job.state === 'JOB_STATE_SUCCEEDED';
                  const unsavedCount = succeeded ? (job.results || []).filter((r, i) => r && !(job.savedPaths?.[i])).length : 0;
                  return (
                    <div key={job.name} className="card">
                      <div className="card-body">
                        {/* Job header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', marginBottom: 2 }}>
                              {job.itemCount} item{job.itemCount !== 1 ? 's' : ''} · {new Date(job.submittedAt).toLocaleString()}
                            </div>
                            {job.meta && (
                              <div style={{ fontSize: 11, color: 'var(--gray-600)', marginBottom: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                {job.meta.model && <span>👤 {job.meta.model}</span>}
                                {job.meta.background && <span>🖼 {job.meta.background}</span>}
                                {job.meta.categories && job.meta.categories.map(c => (
                                  <span key={c}>🏷 {c.replace('_', ' ')}</span>
                                ))}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', fontFamily: 'monospace' }}>{job.name}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: stateInfo.color }}>
                              {isActive && <span className="spinner" style={{ width: 10, height: 10, marginRight: 4, borderColor: stateInfo.color, borderTopColor: 'transparent' }} />}
                              {stateInfo.label}
                            </span>
                            {isActive && <button className="btn btn-ghost btn-sm" onClick={() => handlePollJob(job.name)}>↻ Check</button>}
                            {isActive && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => handleCancelJob(job.name)}>Cancel</button>}
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--gray-500)' }} onClick={() => handleDeleteJob(job.name)} title="Remove from list">✕</button>
                          </div>
                        </div>

                        {/* Item labels with per-item meta */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: succeeded ? 12 : 0 }}>
                          {(job.itemLabels || []).map((lbl, i) => {
                            const m = job.itemMetas?.[i];
                            return (
                              <div key={i} style={{ fontSize: 10, background: 'var(--gray-100)', color: 'var(--gray-600)', borderRadius: 4, padding: '3px 7px' }}>
                                <div style={{ fontWeight: 600 }}>{lbl}</div>
                                {m && (
                                  <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 4, color: 'var(--gray-500)' }}>
                                    {m.model && <span>👤 {m.model}</span>}
                                    {m.background && m.background !== 'None' && <span>🖼 {m.background}</span>}
                                    {m.pose && m.pose !== 'None' && <span>🧍 {m.pose}</span>}
                                    {m.globalInstruction && <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>💬 {m.globalInstruction}</span>}
                                    {m.shotInstruction && <span style={{ fontStyle: 'italic' }}>📌 {m.shotInstruction}</span>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Results */}
                        {succeeded && job.results && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)' }}>Results ({job.results.filter(Boolean).length}/{job.results.length})</span>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {job.results.every(r => !r) && (
                                  <button className="btn btn-ghost btn-sm" onClick={() => handleLoadImages(ji)} disabled={loadingImages[ji]}>
                                    {loadingImages[ji] ? '…' : '📷 Load Images'}
                                  </button>
                                )}
                                {unsavedCount > 0 && (
                                  <button className="btn btn-primary btn-sm" onClick={() => handleSaveAllResults(ji)}>⬇ Save All</button>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                              {job.results.map((img, ri) => {
                                const key = `${ji}_${ri}`;
                                const saved = job.savedPaths?.[ri];
                                return (
                                  <div key={ri} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--gray-200)' }}>
                                    {img ? (
                                      <img src={img} alt="" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                                    ) : saved ? (
                                      <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--green)' }}>✓ Saved</div>
                                    ) : (
                                      <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--red)' }}>Failed</div>
                                    )}
                                    <div style={{ padding: '4px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: 9, color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
                                        {(job.itemLabels?.[ri] || '').replace(/^.*— /, '')}
                                      </span>
                                      {img && !saved && (
                                        <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px', fontSize: 9 }}
                                          onClick={() => handleSaveResult(ji, ri)} disabled={saving[key]}>
                                          {saving[key] ? '…' : 'Save'}
                                        </button>
                                      )}
                                      {saved && (
                                        <span style={{ fontSize: 9, color: 'var(--green)', cursor: 'pointer' }}
                                          onClick={() => img && setLightbox({ src: img, label: job.itemLabels?.[ri] || '' })}>
                                          {img ? '🔍 View' : '✓ History'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}

                        {job.state === 'JOB_STATE_FAILED' && (
                          <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>
                            Job failed. Check your API key and billing status.
                          </div>
                        )}

                        {isActive && (
                          <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 8 }}>
                            Auto-checking every 30 seconds. Batch jobs typically complete in 30–60 minutes.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
        }}>
          <div style={{ fontSize: 12, color: '#ccc', marginBottom: 8, maxWidth: '90vw', textAlign: 'center' }}>{lightbox.label}</div>
          <img src={lightbox.src} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }} />
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>Click anywhere to close</div>
        </div>
      )}
    </div>
  );
}
