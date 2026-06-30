import React, { useState, useEffect } from 'react';
import { getBackgrounds, saveBackground, deleteBackground, generateId } from '../utils/storage';
import { generateBackgroundImage, BACKGROUND_PRESETS } from '../utils/api';

export default function BackgroundLibrary({ isAdmin }) {
  const [backgrounds, setBackgrounds] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatingPreset, setGeneratingPreset] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setBackgrounds(await getBackgrounds());
    setLoading(false);
  }

  async function handleDelete(bg) {
    if (!window.confirm(`Delete background "${bg.name}"?`)) return;
    setBackgrounds(await deleteBackground(bg.id));
  }

  async function handleUsePreset(preset) {
    if (backgrounds.find(b => b.id === preset.id)) return;
    setGeneratingPreset(preset.id);
    try {
      const base64 = await generateBackgroundImage(preset.description);
      setBackgrounds(await saveBackground({
        id: preset.id, name: preset.name, preset: true,
        base64, createdAt: new Date().toISOString(),
      }));
    } catch (e) { alert('Generation failed: ' + e.message); }
    setGeneratingPreset(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div>
          <h1>Background Library</h1>
          <p>Upload or generate studio backgrounds for your shoots</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {isAdmin && <button className="btn btn-outline" onClick={() => setShowGenerateModal(true)}>✨ Generate Custom</button>}
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Background</button>
          </div>
        </div>
      </div>

      <div className="screen-body">
        <div className="section-title" style={{ marginBottom: 14 }}>
          <span>Built-in Presets</span>
          <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 400 }}>Generated on first use</span>
        </div>
        <div className="grid-4" style={{ marginBottom: 32 }}>
          {BACKGROUND_PRESETS.map(preset => {
            const generated = backgrounds.find(b => b.id === preset.id);
            const isGenerating = generatingPreset === preset.id;
            return (
              <div key={preset.id} className="image-card" style={{ cursor: 'default' }}>
                {generated?.base64 ? (
                  <img src={generated.base64} alt={preset.name} className="image-card-thumb" />
                ) : (
                  <div className="image-card-thumb-placeholder" style={{ flexDirection: 'column', gap: 8 }}>
                    {isGenerating
                      ? <><div className="spinner spinner-dark" /><span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Generating…</span></>
                      : <><span>🖼</span><span style={{ fontSize: 11, color: 'var(--gray-500)' }}>Not generated</span></>
                    }
                  </div>
                )}
                <div className="image-card-info">
                  <div className="image-card-name">{preset.name}</div>
                  {!generated && !isGenerating && isAdmin && (
                    <button className="btn btn-gold btn-sm" style={{ width: '100%', marginTop: 6 }} onClick={() => handleUsePreset(preset)}>Generate</button>
                  )}
                  {generated && (
                    <button className="icon-btn icon-btn-danger" style={{ position: 'absolute', top: 6, right: 6, opacity: 1 }} onClick={() => handleDelete(generated)}>🗑</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {loading ? (
          <div className="generating-overlay"><div className="spinner spinner-dark" /></div>
        ) : (() => {
          const custom = backgrounds.filter(b => !BACKGROUND_PRESETS.find(p => p.id === b.id));
          return custom.length > 0 ? (
            <>
              <div className="section-title">Custom Backgrounds</div>
              <div className="grid-4">
                {custom.map(bg => (
                  <div key={bg.id} className="image-card">
                    {bg.base64 ? (
                      <img src={bg.base64} alt={bg.name} className="image-card-thumb" />
                    ) : (
                      <div className="image-card-thumb-placeholder">🖼</div>
                    )}
                    <div className="image-card-info">
                      <div className="image-card-name">{bg.name}</div>
                      {bg.preset && <span className="image-card-tag">Preset</span>}
                    </div>
                    <div className="image-card-actions">
                      <button className="icon-btn icon-btn-danger" onClick={() => handleDelete(bg)}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null;
        })()}
      </div>

      {showUploadModal && (
        <UploadBgModal
          onClose={() => setShowUploadModal(false)}
          onSave={async (data) => { setBackgrounds(await saveBackground(data)); setShowUploadModal(false); }}
        />
      )}
      {isAdmin && showGenerateModal && (
        <GenerateBgModal
          onClose={() => setShowGenerateModal(false)}
          onSave={async (data) => { setBackgrounds(await saveBackground(data)); setShowGenerateModal(false); }}
        />
      )}
    </div>
  );
}

function UploadBgModal({ onClose, onSave }) {
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
      await onSave({ id: generateId('bg'), name, preset: false, base64, createdAt: new Date().toISOString() });
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Upload Background</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label className="form-label">Background Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rooftop Garden" />
        </div>
        <div className="form-group">
          <label className="form-label">Background Image</label>
          {base64 ? (
            <div style={{ textAlign: 'center' }}>
              <img src={base64} alt="preview" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8 }} />
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={handlePick}>Change</button>
            </div>
          ) : (
            <div className="upload-zone" onClick={handlePick}>
              <span className="upload-zone-icon">🖼</span>
              <div className="upload-zone-text"><strong>Click to choose image</strong></div>
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

function GenerateBgModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleGenerate() {
    if (!description) return alert('Please describe the background.');
    setGenerating(true);
    try { setPreview(await generateBackgroundImage(description)); }
    catch (e) { alert('Generation failed: ' + e.message); }
    setGenerating(false);
  }

  async function handleSave() {
    if (!name || !preview) return alert('Please generate a preview and enter a name.');
    setSaving(true);
    try {
      await onSave({ id: generateId('bg'), name, preset: false, base64: preview, createdAt: new Date().toISOString() });
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <span className="modal-title">Generate Custom Background</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: preview ? '1fr 200px' : '1fr', gap: 20 }}>
          <div>
            <div className="form-group">
              <label className="form-label">Background Name</label>
              <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rooftop at Sunset" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Describe the setting, lighting, mood, colors…" rows={5} />
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
