import React, { useState, useEffect, useRef } from 'react';
import { virtualTryOn, prepareBatchVirtualTryOn } from '../utils/api';
import { addToBatchQueue } from '../utils/batchQueue';
import { addHistoryEntry, getModels, getSettings } from '../utils/storage';
import GenerationOptions from './GenerationOptions';
import { getResolution } from '../utils/constants';

export default function WorkflowD({ onBack, onNavigate }) {
  const [garmentBase64, setGarmentBase64] = useState('');
  const [personBase64, setPersonBase64] = useState('');
  const [personTab, setPersonTab] = useState('library'); // 'library' | 'upload'
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [resolution, setResolution] = useState('1080x1440');
  const [geminiError, setGeminiError] = useState('');
  const skipGeminiRef = useRef(false);

  useEffect(() => {
    getModels().then(setModels);
    getSettings().then(s => {
      setResolution(s.defaultResolution || '1080x1440');
    });
  }, []);

  async function pickGarment() {
    const path = await window.electronAPI.openFileDialog();
    if (!path) return;
    setGarmentBase64(await window.electronAPI.readFileAsBase64(path));
    setResult(''); setSaved(false);
  }

  async function pickPerson() {
    const path = await window.electronAPI.openFileDialog();
    if (!path) return;
    setPersonBase64(await window.electronAPI.readFileAsBase64(path));
    setResult(''); setSaved(false);
  }

  async function handleSelectModel(model) {
    setSelectedModel(model);
    const b64 = model.base64;
    setPersonBase64(b64);
    setResult(''); setSaved(false);
  }

  const readyToGenerate = garmentBase64 && personBase64;
  const [batchAdded, setBatchAdded] = useState(0);

  async function handleAddToBatch() {
    if (!garmentBase64) return setError('Please upload a garment image.');
    if (!personBase64) return setError('Please select or upload a person/model.');
    const item = await prepareBatchVirtualTryOn({
      garmentImageBase64: garmentBase64,
      personImageBase64: personBase64,
      quality: 'low', resolution,
      label: 'Virtual Try-On',
    });
    await addToBatchQueue(item);
    setBatchAdded(1);
    setTimeout(() => setBatchAdded(0), 3000);
    if (onNavigate) onNavigate('batch');
  }

  async function handleGenerate() {
    if (!garmentBase64) return setError('Please upload a garment image.');
    if (!personBase64) return setError('Please select or upload a person/model.');
    setGenerating(true);
    setError('');
    setGeminiError('');
    setResult('');
    setSaved(false);
    try {
      const res = getResolution(resolution);
      const generated = await virtualTryOn({
        garmentImageBase64: garmentBase64,
        personImageBase64: personBase64,
        quality: 'medium',
        apiSize: res.apiSize,
        resolution,
        skipGemini: skipGeminiRef.current,
      });
      setResult(generated);
    } catch (e) {
      const isGeminiFail = !skipGeminiRef.current && e.message && (e.message.toLowerCase().includes('gemini') || e.message.toLowerCase().includes('google'));
      if (isGeminiFail) {
        setGeminiError(e.message);
      } else {
        setError(e.message);
      }
    }
    setGenerating(false);
  }

  async function handleDownload() {
    try {
      const filename = `${'tryon'.replace(/[^a-zA-Z0-9]/g,'_')}_${'TryOn'.replace(/[^a-zA-Z0-9]/g,'_')}_${Date.now()}.png`;
      await window.electronAPI.saveFile(result, filename);
      const filePath = `downloaded/${filename}`;
      await addHistoryEntry({
        workflow: 'D',
        productName: 'Virtual Try-On',
        shotType: 'TryOn',
        outputPath: filePath,
      });
      setSaved(true);
    } catch (e) {
      setError('Save failed: ' + e.message);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
        <h1>👗 Virtual Try-On</h1>
        <p>See any garment on any person or model</p>
      </div>

      <div className="screen-body">
        {error && <div className="alert alert-error">⚠ {error}</div>}

        {geminiError && (
          <div style={{ background: 'rgba(220,100,0,0.08)', border: '1px solid #e07020', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: '#a04000', marginBottom: 4 }}>🔮 Gemini failed</div>
            <div style={{ fontSize: 12, color: '#a04000', marginBottom: 10 }}>{geminiError}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { skipGeminiRef.current = true; setGeminiError(''); handleGenerate(); }}>Use OpenAI instead</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setGeminiError('')}>Dismiss</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, maxWidth: 960 }}>

          {/* Column 1: Garment */}
          <div>
            <div className="section-title">1. Garment Image</div>
            <div className="upload-zone" onClick={pickGarment}>
              {garmentBase64 ? (
                <img src={garmentBase64} alt="garment" className="upload-zone-preview" />
              ) : (
                <>
                  <span className="upload-zone-icon">👗</span>
                  <div className="upload-zone-text"><strong>Click to upload</strong></div>
                  <div className="upload-zone-text" style={{ fontSize: 12 }}>Any garment photo</div>
                </>
              )}
            </div>
            {garmentBase64 && (
              <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={pickGarment}>
                Change Garment
              </button>
            )}
          </div>

          {/* Column 2: Person / Model */}
          <div>
            <div className="section-title">2. Person / Model</div>

            <div className="tabs" style={{ marginBottom: 12 }}>
              <button
                className={`tab ${personTab === 'library' ? 'active' : ''}`}
                onClick={() => setPersonTab('library')}
              >
                Model Library
              </button>
              <button
                className={`tab ${personTab === 'upload' ? 'active' : ''}`}
                onClick={() => setPersonTab('upload')}
              >
                Upload Photo
              </button>
            </div>

            {personTab === 'library' ? (
              <>
                {models.length === 0 ? (
                  <div className="alert alert-info">
                    No models in library yet. Use Upload Photo or add models in Model Library.
                  </div>
                ) : (
                  <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                    <div className="grid-2">
                      {models.map(model => (
                        <div
                          key={model.id}
                          className={`image-card ${selectedModel?.id === model.id ? 'selected' : ''}`}
                          onClick={() => handleSelectModel(model)}
                          style={{ cursor: 'pointer' }}
                        >
                          {model.base64 ? (
                            <img src={model.base64 || ''} alt={model.name} className="image-card-thumb" />
                          ) : (
                            <div className="image-card-thumb-placeholder">👤</div>
                          )}
                          <div className="image-card-info">
                            <div className="image-card-name">{model.name}</div>
                            <span className="image-card-tag">{model.bodyType}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="upload-zone" onClick={pickPerson}>
                {personBase64 && personTab === 'upload' ? (
                  <img src={personBase64} alt="person" className="upload-zone-preview" />
                ) : (
                  <>
                    <span className="upload-zone-icon">🧍</span>
                    <div className="upload-zone-text"><strong>Click to upload</strong></div>
                    <div className="upload-zone-text" style={{ fontSize: 12 }}>Any photo of a person</div>
                  </>
                )}
              </div>
            )}

            {/* Preview of selected person */}
            {personTab === 'library' && selectedModel && personBase64 && (
              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <img
                  src={personBase64}
                  alt="selected"
                  style={{ width: 80, aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8 }}
                />
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>{selectedModel.name}</div>
              </div>
            )}
          </div>

          {/* Column 3: Result */}
          <div>
            <div className="section-title">3. Result</div>
            {generating ? (
              <div className="upload-zone" style={{ aspectRatio: '2/3', flexDirection: 'column', gap: 12, cursor: 'default' }}>
                <div className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
                <div className="upload-zone-text">Generating try-on…</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>15–30 seconds</div>
              </div>
            ) : result ? (
              <>
                <img src={result} alt="result" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', borderRadius: 12 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {saved ? (
                    <div className="alert alert-success" style={{ flex: 1, margin: 0 }}>✓ Saved</div>
                  ) : (
                    <>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleDownload}>⬇ Save</button>
                      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={handleGenerate}>↻ Retry</button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="upload-zone" style={{ aspectRatio: '2/3', flexDirection: 'column', gap: 10, cursor: 'default' }}>
                <span style={{ fontSize: 40 }}>👗</span>
                <div className="upload-zone-text">Result appears here</div>
              </div>
            )}
          </div>
        </div>

        {/* Generate button */}
        <div style={{ marginTop: 24, maxWidth: 960 }}>
          <GenerationOptions resolution={resolution} onResolutionChange={setResolution} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold btn-lg" style={{ flex: 1 }} onClick={handleAddToBatch}
              disabled={generating || !readyToGenerate}>
              <div>
                {batchAdded > 0 ? `✓ ${batchAdded} queued` : '📦 Add to Batch'}
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>1 credit</div>
              </div>
            </button>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={handleGenerate}
              disabled={generating || !readyToGenerate}>
              <div>
                {generating ? <><span className="spinner" /> Generating…</> : '✨ Generate'}
                {!generating && <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>3 credits</div>}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
