import React, { useState, useEffect, useRef } from 'react';
import { getBackgrounds, getSettings } from '../utils/storage';
import { changeBackground, prepareBatchChangeBackground } from '../utils/api';
import { addToBatchQueue } from '../utils/batchQueue';
import { addHistoryEntry } from '../utils/storage';
import GenerationOptions from './GenerationOptions';
import { getResolution } from '../utils/constants';

export default function WorkflowA({ onBack, onNavigate }) {
  const [images, setImages] = useState([]); // [{ file, base64, name, result, status, saved, savedPath }]
  const [backgrounds, setBackgrounds] = useState([]);
  const [selectedBg, setSelectedBg] = useState(null);
  const [customBgDesc, setCustomBgDesc] = useState('');
  const [bgTab, setBgTab] = useState('library');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [resolution, setResolution] = useState('1080x1440');
  const [geminiError, setGeminiError] = useState('');
  const skipGeminiRef = useRef(false);
  const [genPhase, setGenPhase] = useState('idle'); // 'idle' | 'preview_done'

  useEffect(() => {
    getBackgrounds().then(setBackgrounds);
    getSettings().then(s => {
      setResolution(s.defaultResolution || '1080x1440');
    });
  }, []);

  async function handlePick() {
    const paths = await window.electronAPI.openMultipleFilesDialog();
    if (!paths || paths.length === 0) return;
    const newImgs = await Promise.all(paths.map(async (p) => ({
      file: p,
      name: p.split(/[\\/]/).pop(),
      base64: await window.electronAPI.readFileAsBase64(p),
      result: '', status: 'idle', saved: false, savedPath: ''
    })));
    setImages(prev => [...prev, ...newImgs]);
    setError('');
  }

  function removeImage(idx) {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }

  async function runGenerate(imagesToProcess) {
    cancelRef.current = false;
    setCancelling(false);
    setGenerating(true);
    setGeminiError('');

    const bgBase64 = (bgTab === 'library' && selectedBg?.base64) ? selectedBg.base64 : null;

    for (let i = 0; i < imagesToProcess.length; i++) {
      const idx = images.indexOf(imagesToProcess[i]);
      if (cancelRef.current) break;
      setImages(prev => { const u = [...prev]; u[idx] = { ...u[idx], status: 'generating', result: '', saved: false }; return u; });
      try {
        const res = getResolution(resolution);
        const generated = await changeBackground({
          productImageBase64: imagesToProcess[i].base64,
          backgroundImageBase64: bgBase64,
          backgroundDescription: bgTab === 'describe' ? customBgDesc : null,
          quality: 'medium', apiSize: res.apiSize, resolution,
          skipGemini: skipGeminiRef.current,
        });
        setImages(prev => { const u = [...prev]; u[idx] = { ...u[idx], status: 'done', result: generated }; return u; });
      } catch (e) {
        const isGeminiFail = !skipGeminiRef.current && e.message &&
          (e.message.includes('gemini') || e.message.includes('Gemini') || e.message.includes('google') || e.message.includes('Google') || e.message.includes('API key'));
        if (isGeminiFail) {
          setGeminiError(e.message);
          setImages(prev => { const u = [...prev]; u[idx] = { ...u[idx], status: 'idle' }; return u; });
          setGenerating(false);
          return false;
        }
        setImages(prev => { const u = [...prev]; u[idx] = { ...u[idx], status: 'error', error: e.message }; return u; });
      }
    }
    setGenerating(false);
    setCancelling(false);
    cancelRef.current = false;
    return true;
  }

  async function handleGeneratePreview() {
    if (images.length === 0) return setError('Please upload at least one image.');
    if (bgTab === 'library' && !selectedBg) return setError('Please select a background.');
    if (bgTab === 'describe' && !customBgDesc.trim()) return setError('Please describe a background.');
    setError('');
    setGenPhase('idle');
    const ok = await runGenerate([images[0]]);
    if (ok && images.length > 1 && !cancelRef.current) setGenPhase('preview_done');
  }

  async function handleContinueGenerating() {
    if (images.length <= 1) return;
    setGenPhase('continuing');
    await runGenerate(images.slice(1));
    setGenPhase('idle');
  }

  async function handleSaveOne(idx) {
    const img = images[idx];
    if (!img?.result) return;
    try {
      const productName = img.name.replace(/\.[^.]+$/, '');
      const filename = `${(productName||'product').replace(/[^a-zA-Z0-9]/g,'_')}_${'Background'.replace(/[^a-zA-Z0-9]/g,'_')}_${Date.now()}.png`;
      await window.electronAPI.saveFile(img.result, filename);
      const filePath = `downloaded/${filename}`;
      await addHistoryEntry({ workflow: 'A', productName: img.name, backgroundId: selectedBg?.id, shotType: 'Background', outputPath: filePath });
      setImages(prev => { const u = [...prev]; u[idx] = { ...u[idx], saved: true, savedPath: filePath }; return u; });
    } catch (e) { setError('Save failed: ' + e.message); }
  }

  async function handleSaveAll() {
    for (let i = 0; i < images.length; i++) {
      if (images[i].status === 'done' && !images[i].saved) await handleSaveOne(i);
    }
  }

  async function handleAddAllToBatch() {
    if (images.length === 0) return setError('Please upload at least one image.');
    if (bgTab === 'library' && !selectedBg) return setError('Please select a background.');
    if (bgTab === 'describe' && !customBgDesc.trim()) return setError('Please describe a background.');
    const bgBase64 = (bgTab === 'library' && selectedBg?.base64) ? selectedBg.base64 : null;
    for (const img of images) {
      const item = await prepareBatchChangeBackground({
        productImageBase64: img.base64,
        backgroundImageBase64: bgBase64,
        backgroundDescription: bgTab === 'describe' ? customBgDesc : null,
        quality: 'low', resolution,
        label: `Background — ${img.name}`,
      });
      await addToBatchQueue(item);
    }
    if (onNavigate) onNavigate('batch');
  }

  const doneCount = images.filter(img => img.status === 'done').length;
  const hasResults = doneCount > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
            <h1>🌅 Change Background</h1>
            <p>Upload one or more images and swap the background in batch</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {generating && (
              <button className="btn btn-outline" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={() => { cancelRef.current = true; setCancelling(true); }} disabled={cancelling}>
                {cancelling ? '⏳ Stopping…' : '⏹ Stop'}
              </button>
            )}
            {!generating && hasResults && (
              <button className="btn btn-primary" onClick={handleSaveAll}>⬇ Save All</button>
            )}
          </div>
        </div>
      </div>

      <div className="screen-body">
        {error && <div className="alert alert-error">⚠ {error}</div>}

        {geminiError && (
          <div style={{ background: 'rgba(220,100,0,0.08)', border: '1px solid #e07020', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: '#a04000', marginBottom: 4 }}>🔮 Gemini failed</div>
            <div style={{ fontSize: 12, color: '#a04000', marginBottom: 10 }}>{geminiError}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { skipGeminiRef.current = true; setGeminiError(''); handleGeneratePreview(); }}>
                Use OpenAI instead
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setGeminiError('')}>Dismiss</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 28 }}>
          {/* Left panel */}
          <div>
            <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>1. Images ({images.length})</span>
              <button className="btn btn-ghost btn-sm" onClick={handlePick}>+ Add</button>
            </div>

            {images.length === 0 ? (
              <div className="upload-zone" style={{ marginBottom: 16 }} onClick={handlePick}>
                <span className="upload-zone-icon">📦</span>
                <div className="upload-zone-text"><strong>Click to upload</strong> — select multiple</div>
                <div className="upload-zone-text" style={{ fontSize: 12 }}>PNG, JPG, WEBP</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 260, overflowY: 'auto' }}>
                {images.map((img, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--gray-50)', borderRadius: 8, padding: '6px 10px' }}>
                    <img src={img.base64} alt="" style={{ width: 40, height: 54, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--navy)' }}>{img.name}</span>
                    {img.status === 'generating' && <span className="spinner spinner-dark" style={{ width: 14, height: 14 }} />}
                    {img.status === 'done' && <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>}
                    {img.status === 'error' && <span style={{ color: 'var(--red)', fontSize: 12 }}>✗</span>}
                    {img.status === 'idle' && (
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => removeImage(i)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="section-title">2. Background</div>
            <div className="tabs" style={{ marginBottom: 10 }}>
              <button className={`tab ${bgTab === 'library' ? 'active' : ''}`} onClick={() => setBgTab('library')}>From Library</button>
              <button className={`tab ${bgTab === 'describe' ? 'active' : ''}`} onClick={() => setBgTab('describe')}>Describe</button>
            </div>

            {bgTab === 'library' ? (
              backgrounds.length === 0 ? (
                <div className="alert alert-info" style={{ marginBottom: 12 }}>No backgrounds yet. Add in Background Library.</div>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                  <div className="grid-3">
                    {backgrounds.map(bg => (
                      <div key={bg.id} className={`image-card ${selectedBg?.id === bg.id ? 'selected' : ''}`}
                        style={{ cursor: 'pointer' }} onClick={() => setSelectedBg(bg)}>
                        {bg.base64 ? <img src={bg.base64 || ''} alt={bg.name} className="image-card-thumb" />
                          : <div className="image-card-thumb-placeholder">🖼</div>}
                        <div className="image-card-info"><div className="image-card-name">{bg.name}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <textarea className="form-input" value={customBgDesc} onChange={e => setCustomBgDesc(e.target.value)}
                placeholder="e.g. Warm golden-hour rooftop terrace in Mumbai" rows={3} style={{ marginBottom: 12 }} />
            )}

            <GenerationOptions resolution={resolution} onResolutionChange={setResolution} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-gold btn-lg" style={{ flex: 1 }} onClick={handleAddAllToBatch}
                disabled={generating || images.length === 0}>
                <div>
                  📦 Add to Batch
                  <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>{images.length > 0 ? `${images.length} image${images.length !== 1 ? 's' : ''}` : '1 credit/image'}</div>
                </div>
              </button>

              {generating ? (
                <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled>
                  <div><span className="spinner" /> Generating…</div>
                </button>
              ) : genPhase === 'preview_done' ? (
                <div style={{ flex: 1, border: '1px solid #48bb78', borderRadius: 10, padding: '10px 14px', background: 'rgba(72,187,120,0.08)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>
                    ✓ First image done! Continue with {images.length - 1} more?
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleContinueGenerating}>
                      ▶ Continue ({(images.length - 1) * 3} credits)
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setGenPhase('idle')}>Done</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={handleGeneratePreview}
                  disabled={images.length === 0}>
                  <div>
                    ✨ Preview First Image
                    <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>{images.length > 0 ? `${images.length * 3} credits` : '3 credits/image'}</div>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Right panel: results grid */}
          <div>
            <div className="section-title">3. Results</div>
            {images.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 300 }}>
                <span className="empty-state-icon">🌅</span>
                <div className="empty-state-desc">Upload images and generate to see results here</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {images.map((img, i) => (
                  <div key={i} className="card">
                    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{img.name}</span>
                      {img.status === 'generating' && <span className="spinner spinner-dark" style={{ width: 14, height: 14 }} />}
                      {img.status === 'done' && !img.saved && <span style={{ color: 'var(--green)', fontSize: 11 }}>✓ Ready</span>}
                      {img.status === 'done' && img.saved && (
                        <span style={{ color: 'var(--green)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => img.savedPath && window.electronAPI.openInExplorer(img.savedPath)}>💾 Open</span>
                      )}
                      {img.status === 'error' && <span style={{ color: 'var(--red)', fontSize: 11 }}>Error</span>}
                    </div>

                    {/* Before / After */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                      <div style={{ position: 'relative' }}>
                        <img src={img.base64} alt="before" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover' }} />
                        <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>Before</span>
                      </div>
                      <div style={{ position: 'relative' }}>
                        {img.result ? (
                          <>
                            <img src={img.result} alt="after" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover' }} />
                            <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>After</span>
                          </>
                        ) : img.status === 'generating' ? (
                          <div style={{ width: '100%', aspectRatio: '2/3', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gray-100)' }}>
                            <div className="spinner spinner-dark" />
                          </div>
                        ) : img.status === 'error' ? (
                          <div style={{ width: '100%', aspectRatio: '2/3', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gray-100)', fontSize: 11, color: 'var(--red)', padding: 8, textAlign: 'center' }}>
                            {img.error}
                          </div>
                        ) : (
                          <div style={{ width: '100%', aspectRatio: '2/3', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gray-100)' }}>
                            <span style={{ fontSize: 24 }}>⏳</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {img.status === 'done' && !img.saved && (
                      <div style={{ padding: '8px 10px', display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => handleSaveOne(i)}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          setImages(prev => { const u = [...prev]; u[i] = { ...u[i], status: 'idle', result: '' }; return u; });
                        }}>↻</button>
                      </div>
                    )}
                    {img.status === 'error' && (
                      <div style={{ padding: '6px 10px' }}>
                        <button className="btn btn-outline btn-sm" style={{ width: '100%' }} onClick={() => {
                          setImages(prev => { const u = [...prev]; u[i] = { ...u[i], status: 'idle', result: '' }; return u; });
                          setTimeout(handleGeneratePreview, 100);
                        }}>↻ Retry</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
