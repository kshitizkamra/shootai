import React, { useState, useEffect } from 'react';
import { getPoses, savePose, deletePose, generateId } from '../utils/storage';

export default function PoseLibrary() {
  const [poses, setPoses] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setPoses(await getPoses());
    setLoading(false);
  }

  async function handleDelete(pose) {
    if (!window.confirm(`Delete pose "${pose.name}"?`)) return;
    setPoses(await deletePose(pose.id));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div>
          <h1>Pose Library</h1>
          <p>Upload styled pose references to guide the model's posture in shoots</p>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Poses</button>
          </div>
        </div>
      </div>

      <div className="screen-body">
        <div className="alert alert-info" style={{ marginBottom: 20, fontSize: 12 }}>
          💡 Generate mannequin pose images using ChatGPT or Gemini, then upload them here. Use prompt: <em>"A white featureless tailor's mannequin in [pose description]. Plain white studio background, full body visible, soft lighting, no clothing."</em>
        </div>

        {loading ? (
          <div className="generating-overlay"><div className="spinner spinner-dark" /></div>
        ) : poses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray-500)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🧍</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No poses yet</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>Upload pose references to get started</div>
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Poses</button>
          </div>
        ) : (
          <>
            <div className="section-title" style={{ marginBottom: 14 }}>Poses ({poses.length})</div>
            <div className="grid-4">
              {poses.map(pose => (
                <div key={pose.id} className="image-card">
                  {pose.base64 ? (
                    <img src={pose.base64} alt={pose.name} className="image-card-thumb" />
                  ) : (
                    <div className="image-card-thumb-placeholder">🧍</div>
                  )}
                  <div className="image-card-info">
                    <div className="image-card-name">{pose.name}</div>
                  </div>
                  <div className="image-card-actions">
                    <button className="icon-btn icon-btn-danger" onClick={() => handleDelete(pose)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showUploadModal && (
        <BulkUploadModal
          prefix="pose"
          icon="🧍"
          existingCount={poses.length}
          onClose={() => setShowUploadModal(false)}
          onSave={async (items) => {
            let updated = poses;
            for (const item of items) {
              updated = await savePose({ id: generateId('pose'), ...item, createdAt: new Date().toISOString() });
            }
            setPoses(updated);
            setShowUploadModal(false);
          }}
        />
      )}
    </div>
  );
}

function BulkUploadModal({ prefix, icon, existingCount, onClose, onSave }) {
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  function handleFilePick(e) {
    const picked = Array.from(e.target.files);
    if (!picked.length) return;
    const currentCount = files.length;
    let loaded = new Array(picked.length);
    let done = 0;
    picked.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = ev => {
        loaded[i] = { name: `${prefix}${existingCount + currentCount + i + 1}`, base64: ev.target.result };
        done++;
        if (done === picked.length) {
          setFiles(prev => {
            const next = [...prev, ...loaded];
            return next.map((f, idx) => ({ ...f, name: `${prefix}${existingCount + idx + 1}` }));
          });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function handleRemove(idx) {
    setFiles(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((f, i) => ({ ...f, name: `${prefix}${existingCount + i + 1}` }));
    });
  }

  async function handleSave() {
    if (!files.length) return;
    setSaving(true);
    try { await onSave(files); }
    catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  const label = prefix.charAt(0).toUpperCase() + prefix.slice(1);

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <span className="modal-title">Upload {label}s</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          border: '2px dashed var(--gray-300)', borderRadius: 10, padding: '16px 24px',
          cursor: 'pointer', marginBottom: 16, color: 'var(--gray-600)', fontSize: 14,
        }}>
          <span style={{ fontSize: 20 }}>{icon}</span>
          <span><strong>Click to choose images</strong> — select multiple at once</span>
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFilePick} />
        </label>

        {files.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 10 }}>
              {files.length} image{files.length > 1 ? 's' : ''} ready — auto-named sequentially
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 10, maxHeight: 320, overflowY: 'auto', marginBottom: 16,
            }}>
              {files.map((f, i) => (
                <div key={i} style={{ position: 'relative', textAlign: 'center' }}>
                  <img src={f.base64} alt={f.name} style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', borderRadius: 6 }} />
                  <div style={{ fontSize: 11, color: 'var(--gray-600)', marginTop: 4, fontWeight: 600 }}>{f.name}</div>
                  <button onClick={() => handleRemove(i)} style={{
                    position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)',
                    border: 'none', borderRadius: '50%', width: 20, height: 20,
                    color: '#fff', fontSize: 12, cursor: 'pointer', lineHeight: 1,
                  }}>×</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !files.length}>
            {saving ? <><span className="spinner" /> Saving…</> : `Save ${files.length || ''} ${label}${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
