import React, { useState, useEffect } from 'react';
import { getModels, saveModel, deleteModel, generateId } from '../utils/storage';

const BODY_TYPES = ['Hourglass', 'Pear', 'Apple', 'Rectangle', 'Custom'];

export default function ModelLibrary({ isAdmin }) {
  const [models, setModels] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
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
          <p>Upload fashion models for your shoots</p>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Models</button>
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
            <div className="empty-state-desc">Upload model photos to get started</div>
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>+ Upload Models</button>
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
                  {model.bodyType && <span className="image-card-tag">{model.bodyType}</span>}
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
        <BulkUploadModal
          type="model"
          prefix="Model"
          icon="📷"
          existingCount={models.length}
          bodyTypes={BODY_TYPES}
          onClose={() => setShowUploadModal(false)}
          onSave={async (items) => {
            let updated = models;
            for (const item of items) {
              updated = await saveModel({ id: generateId('model'), ...item, createdAt: new Date().toISOString() });
            }
            setModels(updated);
            setShowUploadModal(false);
          }}
        />
      )}
    </div>
  );
}

function BulkUploadModal({ type, prefix, icon, existingCount, bodyTypes, onClose, onSave }) {
  const [files, setFiles] = useState([]); // [{ name, base64 }]
  const [bodyType, setBodyType] = useState('Hourglass');
  const [saving, setSaving] = useState(false);

  function handleFilePick(e) {
    const picked = Array.from(e.target.files);
    if (!picked.length) return;
    let loaded = [];
    picked.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = ev => {
        const autoName = `${prefix.toLowerCase()}${existingCount + i + 1}`;
        loaded.push({ name: autoName, base64: ev.target.result });
        if (loaded.length === picked.length) {
          // sort by original index
          loaded.sort((a, b) => {
            const ai = parseInt(a.name.replace(/\D/g, ''));
            const bi = parseInt(b.name.replace(/\D/g, ''));
            return ai - bi;
          });
          setFiles(prev => {
            const next = [...prev];
            // re-index all from existingCount + prev.length
            loaded.forEach((f, idx) => {
              f.name = `${prefix.toLowerCase()}${existingCount + prev.length + idx + 1}`;
            });
            return [...next, ...loaded];
          });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function handleRemove(idx) {
    setFiles(prev => {
      const next = prev.filter((_, i) => i !== idx);
      // re-number after removal
      return next.map((f, i) => ({ ...f, name: `${prefix.toLowerCase()}${existingCount + i + 1}` }));
    });
  }

  async function handleSave() {
    if (!files.length) return;
    setSaving(true);
    try {
      const items = files.map(f => bodyTypes
        ? { name: f.name, base64: f.base64, bodyType }
        : { name: f.name, base64: f.base64 }
      );
      await onSave(items);
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <span className="modal-title">Upload {prefix}s</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {bodyTypes && (
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Body Type (applies to all)</label>
            <select className="form-select" value={bodyType} onChange={e => setBodyType(e.target.value)}>
              {bodyTypes.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        )}

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
            {saving ? <><span className="spinner" /> Saving…</> : `Save ${files.length || ''} ${prefix}${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
