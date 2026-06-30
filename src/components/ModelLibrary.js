import React, { useState, useEffect } from 'react';
import { getModels, saveModel, deleteModel, generateId } from '../utils/storage';
import { generateModelImage } from '../utils/api';

const BODY_TYPES = ['Hourglass', 'Pear', 'Apple', 'Rectangle', 'Custom'];

export default function ModelLibrary({ isAdmin }) {
  const [models, setModels] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setModels(await getModels());
    setLoading(false);
  }

  async function handleDelete(model) {
    if (!window.confirm(`Delete model "${model.name}"?`)) return;
    setModels(await deleteModel(model.id));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div>
          <h1>Model Library</h1>
          <p>Upload or generate AI fashion models</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {isAdmin && <button className="btn btn-outline" onClick={() => setShowGenerateModal(true)}>✨ Generate Model</button>}
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Model</button>
          </div>
        </div>
      </div>

      <div className="screen-body">
        {loading ? (
          <div className="generating-overlay"><div className="spinner spinner-dark" /></div>
        ) : models.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">👤</span>
            <div className="empty-state-title">No models yet</div>
            <div className="empty-state-desc">Upload a model photo or generate one with AI</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {isAdmin && <button className="btn btn-outline" onClick={() => setShowGenerateModal(true)}>✨ Generate Model</button>}
              <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Model</button>
            </div>
          </div>
        ) : (
          <div className="grid-4">
            {models.map(model => (
              <div key={model.id} className="image-card">
                {model.base64 ? (
                  <img src={model.base64} alt={model.name} className="image-card-thumb" />
                ) : (
                  <div className="image-card-thumb-placeholder">👤</div>
                )}
                <div className="image-card-info">
                  <div className="image-card-name">{model.name}</div>
                  <span className="image-card-tag">{model.bodyType}</span>
                </div>
                <div className="image-card-actions">
                  <button className="icon-btn icon-btn-danger" onClick={() => handleDelete(model)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showUploadModal && (
        <UploadModelModal
          onClose={() => setShowUploadModal(false)}
          onSave={async (data) => { setModels(await saveModel(data)); setShowUploadModal(false); }}
        />
      )}
      {isAdmin && showGenerateModal && (
        <GenerateModelModal
          onClose={() => setShowGenerateModal(false)}
          onSave={async (data) => { setModels(await saveModel(data)); setShowGenerateModal(false); }}
        />
      )}
    </div>
  );
}

function UploadModelModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [bodyType, setBodyType] = useState('Hourglass');
  const [base64, setBase64] = useState('');
  const [saving, setSaving] = useState(false);

  async function handlePick() {
    const fileId = await window.electronAPI.openFileDialog();
    if (!fileId) return;
    const b64 = await window.electronAPI.readFileAsBase64(fileId);
    setBase64(b64);
  }

  async function handleSave() {
    if (!name || !base64) return alert('Please enter a name and select an image.');
    setSaving(true);
    try {
      await onSave({ id: generateId('model'), name, bodyType, base64, createdAt: new Date().toISOString() });
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Upload Model</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label className="form-label">Model Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Priya - Hourglass" />
        </div>
        <div className="form-group">
          <label className="form-label">Body Type</label>
          <select className="form-select" value={bodyType} onChange={e => setBodyType(e.target.value)}>
            {BODY_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Model Photo</label>
          {base64 ? (
            <div style={{ textAlign: 'center' }}>
              <img src={base64} alt="preview" style={{ width: 160, aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8 }} />
              <br />
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={handlePick}>Change Photo</button>
            </div>
          ) : (
            <div className="upload-zone" onClick={handlePick}>
              <span className="upload-zone-icon">📷</span>
              <div className="upload-zone-text"><strong>Click to choose photo</strong></div>
              <div className="upload-zone-text" style={{ fontSize: 12 }}>PNG, JPG, WEBP</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name || !base64}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save Model'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GenerateModelModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [bodyType, setBodyType] = useState('Hourglass');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleGenerate() {
    if (!description) return alert('Please describe the model.');
    setGenerating(true);
    try {
      const b64 = await generateModelImage(`${bodyType} body type Indian woman. ${description}`);
      setPreview(b64);
    } catch (e) { alert('Generation failed: ' + e.message); }
    setGenerating(false);
  }

  async function handleSave() {
    if (!name || !preview) return alert('Please generate an image and enter a name.');
    setSaving(true);
    try {
      await onSave({ id: generateId('model'), name, bodyType, base64: preview, createdAt: new Date().toISOString() });
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <span className="modal-title">Generate AI Model</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: preview ? '1fr 180px' : '1fr', gap: 20 }}>
          <div>
            <div className="form-group">
              <label className="form-label">Model Name</label>
              <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Anya - Pear" />
            </div>
            <div className="form-group">
              <label className="form-label">Body Type</label>
              <select className="form-select" value={bodyType} onChange={e => setBodyType(e.target.value)}>
                {BODY_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="e.g. 25 year old, medium skin tone, long dark hair, tall, natural makeup" rows={4} />
            </div>
            <button className="btn btn-gold" onClick={handleGenerate} disabled={generating || !description}>
              {generating ? <><span className="spinner" /> Generating…</> : '✨ Generate Preview'}
            </button>
          </div>
          {preview && (
            <div style={{ textAlign: 'center' }}>
              <img src={preview} alt="generated" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8 }} />
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={handleGenerate} disabled={generating}>Regenerate</button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name || !preview}>
            {saving ? <><span className="spinner" /> Saving…</> : 'Save to Library'}
          </button>
        </div>
      </div>
    </div>
  );
}
