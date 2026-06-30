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
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Pose</button>
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
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Pose</button>
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
        <UploadPoseModal
          onClose={() => setShowUploadModal(false)}
          onSave={async (data) => { setPoses(await savePose(data)); setShowUploadModal(false); }}
        />
      )}
    </div>
  );
}

function UploadPoseModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [base64, setBase64] = useState('');
  const [saving, setSaving] = useState(false);

  async function handlePick() {
    const fileId = await window.electronAPI.openFileDialog();
    if (!fileId) return;
    setBase64(await window.electronAPI.readFileAsBase64(fileId));
  }

  async function handleSave() {
    if (!name || !base64) return alert('Please enter a name and select an image.');
    setSaving(true);
    try {
      await onSave({ id: generateId('pose'), name, base64, createdAt: new Date().toISOString() });
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Upload Pose Reference</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label className="form-label">Pose Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. One Hand on Hip, Walking Forward" />
        </div>
        <div className="form-group">
          <label className="form-label">Pose Image</label>
          {base64 ? (
            <div style={{ textAlign: 'center' }}>
              <img src={base64} alt="preview" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8 }} />
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={handlePick}>Change</button>
            </div>
          ) : (
            <div className="upload-zone" onClick={handlePick}>
              <span className="upload-zone-icon">🧍</span>
              <div className="upload-zone-text"><strong>Click to choose image</strong></div>
              <div className="upload-zone-sub">Mannequin pose reference recommended</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name || !base64}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
