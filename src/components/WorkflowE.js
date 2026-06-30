import React, { useState, useEffect, useRef } from 'react';
import { getModels, getBackgrounds, getPoses, addHistoryEntry, getSettings, saveSettings } from '../utils/storage';
import { generatePDPShotE, prepareBatchPDPShotE } from '../utils/api';
import { addToBatchQueue } from '../utils/batchQueue';
import GenerationOptions from './GenerationOptions';
import { getResolution } from '../utils/constants';

const CATEGORIES = [
  { id: 'full_outfit', label: 'Full Outfit' },
  { id: 'topwear',    label: 'Topwear' },
  { id: 'bottomwear', label: 'Bottomwear' },
  { id: 'innerwear',  label: 'Innerwear' },
  { id: 'outerwear',  label: 'Outerwear' },
  { id: 'footwear',   label: 'Footwear' },
];

const BASE_SHOT_TYPES = [
  { id: 'Front',  label: 'Front',  sub: 'Full / Focused Body' },
  { id: 'Styled', label: 'Styled', sub: 'Editorial — always full body' },
  { id: 'Side',   label: 'Side',   sub: 'Full / Focused Body' },
  { id: 'Back',   label: 'Back',   sub: 'Full / Focused Body' },
];

// ── Canvas crop helper ────────────────────────────────────────────────────
// Crops a base64 image to 2:3 portrait at a given horizontal offset fraction (0–1)
function cropToPotrait(base64, xFraction) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const targetH = img.height;
      const targetW = Math.round(img.height * (2 / 3));
      const maxX = Math.max(0, img.width - targetW);
      const xOffset = Math.round(xFraction * maxX);
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, xOffset, 0, targetW, targetH, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(base64); // fallback: return original
    img.src = base64;
  });
}

// Check if a base64 image is panoramic (wider than ~2.5:1)
function detectPanoramic(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width / img.height > 2.5);
    img.onerror = () => resolve(false);
    img.src = base64;
  });
}

// Spread random offsets evenly across [0.05, 0.95] for n shots
function spreadOffsets(n) {
  const offsets = [];
  for (let i = 0; i < n; i++) {
    const base = n === 1 ? 0.5 : i / (n - 1);
    const jitter = (Math.random() - 0.5) * 0.12;
    offsets.push(Math.max(0.02, Math.min(0.98, base + jitter)));
  }
  return offsets;
}

export default function WorkflowE({ onBack, onNavigate }) {
  const [products, setProducts] = useState([{ name: '', images: [], category: 'full_outfit' }]);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [backgrounds, setBackgrounds] = useState([]);
  const [selectedBg, setSelectedBg] = useState(null);
  const [bgIsPanoramic, setBgIsPanoramic] = useState(false);
  const [poses, setPoses] = useState([]);
  const [selectedPose, setSelectedPose] = useState(null);

  const [selectedShots, setSelectedShots] = useState(['Front', 'Styled', 'Side', 'Back']);
  // detailNotes: array of strings — each generates a Detail Close-Up shot
  const [detailNotes, setDetailNotes] = useState(['']);
  const [includeDetail, setIncludeDetail] = useState(true);

  const [globalInstruction, setGlobalInstruction] = useState('');
  const [shotInstructions, setShotInstructions] = useState({});

  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelRef = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState({});
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [resolution, setResolution] = useState('1080x1440');
  const [geminiError, setGeminiError] = useState('');
  const [batchAdded, setBatchAdded] = useState(0);
  const skipGeminiRef = useRef(false);
  const [genPhase, setGenPhase] = useState('idle'); // 'idle' | 'preview_done'

  useEffect(() => {
    getModels().then(setModels);
    getBackgrounds().then(setBackgrounds);
    getPoses().then(setPoses);
    getSettings().then(s => {
      setResolution(s.defaultResolution || '1080x1440');
      if (s.pdpGlobalInstruction) setGlobalInstruction(s.pdpGlobalInstruction);
      if (s.pdpShotInstructions) setShotInstructions(s.pdpShotInstructions);
    });
  }, []);

  // Auto-save instructions
  const instructionsMounted = useRef(false);
  useEffect(() => {
    if (!instructionsMounted.current) { instructionsMounted.current = true; return; }
    const t = setTimeout(() => {
      getSettings().then(s => saveSettings({ ...s, pdpGlobalInstruction: globalInstruction, pdpShotInstructions: shotInstructions }));
    }, 1000);
    return () => clearTimeout(t);
  }, [globalInstruction, shotInstructions]);

  // ── Product helpers ───────────────────────────────────────────────────────
  function addProduct() {
    if (products.length >= 3) return;
    setProducts([...products, { name: '', images: [], category: 'full_outfit' }]);
  }
  function removeProduct(i) { setProducts(products.filter((_, idx) => idx !== i)); }
  function updateProduct(i, key, value) {
    const updated = [...products];
    updated[i] = { ...updated[i], [key]: value };
    setProducts(updated);
  }
  async function handleProductPick(i) {
    const paths = await window.electronAPI.openMultipleFilesDialog();
    if (!paths || paths.length === 0) return;
    const newImages = await Promise.all(paths.map(async (p) => ({
      file: p,
      base64: await window.electronAPI.readFileAsBase64(p),
      name: p.startsWith('web-file:') ? p.split(':').pop() : p.split(/[\\/]/).pop(),
    })));
    setProducts(prev => {
      const updated = [...prev];
      updated[i] = { ...updated[i], images: [...(updated[i].images || []), ...newImages] };
      return updated;
    });
  }
  function removeProductImage(pi, imgIdx) {
    setProducts(prev => {
      const updated = [...prev];
      updated[pi] = { ...updated[pi], images: updated[pi].images.filter((_, j) => j !== imgIdx) };
      return updated;
    });
  }

  // ── Background selection + panoramic detection ────────────────────────────
  async function handleSelectBg(bg) {
    setSelectedBg(bg);
    setBgIsPanoramic(false);
    if (bg?.base64) {
      const pan = await detectPanoramic(bg.base64);
      setBgIsPanoramic(pan);
    }
  }

  // ── Shot helpers ──────────────────────────────────────────────────────────
  function toggleShot(shotId) {
    setSelectedShots(prev => prev.includes(shotId) ? prev.filter(s => s !== shotId) : [...prev, shotId]);
  }
  function addDetailNote() { setDetailNotes(prev => [...prev, '']); }
  function removeDetailNote(i) { setDetailNotes(prev => prev.filter((_, idx) => idx !== i)); }
  function updateDetailNote(i, val) {
    setDetailNotes(prev => { const n = [...prev]; n[i] = val; return n; });
  }

  // ── Build all shots for a product (base shots + detail notes) ─────────────
  function buildShotList() {
    const shots = [...selectedShots];
    if (includeDetail) {
      detailNotes.forEach((_, i) => shots.push(`Detail Close-Up${detailNotes.length > 1 ? ` ${i + 1}` : ''}`));
    }
    return shots;
  }

  // ── Background crop for a given shot index ────────────────────────────────
  async function getBgBase64ForShot(bgBase64, shotIndex, totalShots) {
    if (!bgIsPanoramic) return bgBase64;
    const offsets = spreadOffsets(totalShots);
    return await cropToPotrait(bgBase64, offsets[shotIndex]);
  }

  // ── Core generate loop ────────────────────────────────────────────────────
  async function runGenerate(shotsToRun) {
    const validProds = products.filter(p => p.images && p.images.length > 0 && p.name);
    const totalJobs = validProds.length * shotsToRun.length;
    setProgress({ done: 0, total: totalJobs });
    setGenerating(true);
    setCancelling(false);
    cancelRef.current = false;
    setGeminiError('');

    const modelBase64 = selectedModel.base64;
    const bgBase64Raw = selectedBg.base64;
    const poseBase64 = selectedPose?.base64 || null;
    let done = 0;

    for (let pi = 0; pi < validProds.length; pi++) {
      const product = validProds[pi];
      const category = product.category || 'full_outfit';
      for (let si = 0; si < shotsToRun.length; si++) {
        const shot = shotsToRun[si];
        const key = `${pi}_${shot}`;
        if (cancelRef.current) {
          setResults(prev => ({ ...prev, [key]: { status: 'cancelled', base64: '', error: 'Cancelled', saved: false } }));
          continue;
        }
        setResults(prev => ({ ...prev, [key]: { status: 'generating', base64: '', error: '' } }));

        const isDetail = shot.startsWith('Detail Close-Up');
        const shotType = isDetail ? 'Detail Close-Up' : shot;
        const detailIdx = isDetail && detailNotes.length > 1
          ? parseInt(shot.replace('Detail Close-Up ', '')) - 1 : 0;
        const detailNote = isDetail ? (detailNotes[detailIdx] || detailNotes[0] || '') : '';
        const bgBase64 = await getBgBase64ForShot(bgBase64Raw, si, shotsToRun.length);

        try {
          const res = getResolution(resolution);
          const generated = await generatePDPShotE({
            modelImageBase64: modelBase64,
            productImagesBase64: product.images.map(img => img.base64),
            backgroundImageBase64: bgBase64,
            poseImageBase64: poseBase64,
            shotType, productName: product.name, category,
            modelBodyType: selectedModel.bodyType,
            modelDescription: '',
            detailNote, globalInstruction,
            shotInstruction: shotInstructions[shotType] || '',
            quality: 'medium', apiSize: res.apiSize, resolution,
            skipGemini: skipGeminiRef.current,
          });
          setResults(prev => ({ ...prev, [key]: { status: 'done', base64: generated, error: '', saved: false } }));
        } catch (e) {
          const isGeminiFail = !skipGeminiRef.current && e.message &&
            (e.message.toLowerCase().includes('gemini') || e.message.toLowerCase().includes('google'));
          if (isGeminiFail) {
            setGeminiError(e.message);
            setResults(prev => ({ ...prev, [key]: { status: 'idle', base64: '', error: '' } }));
            setGenerating(false);
            return false;
          }
          setResults(prev => ({ ...prev, [key]: { status: 'error', base64: '', error: e.message, saved: false } }));
        }
        done++;
        setProgress({ done, total: totalJobs });
      }
    }
    setGenerating(false);
    setCancelling(false);
    cancelRef.current = false;
    return true;
  }

  // ── Generate preview (first shot only) ───────────────────────────────────
  async function handleGeneratePreview() {
    const vp = products.filter(p => p.images && p.images.length > 0 && p.name);
    if (vp.length === 0) return setError('Please add at least one product with an image and name.');
    if (!selectedModel) return setError('Please select a model.');
    if (!selectedBg) return setError('Please select a background.');
    if (selectedShots.length === 0 && !includeDetail) return setError('Please select at least one shot type.');
    const shots = buildShotList();
    if (shots.length === 0) return;
    setResults({});
    setStep(2);
    setGenPhase('idle');
    setError('');
    const ok = await runGenerate([shots[0]]);
    if (ok && shots.length > 1 && !cancelRef.current) setGenPhase('preview_done');
  }

  // ── Continue generating remaining shots ───────────────────────────────────
  async function handleContinueGenerating() {
    const shots = buildShotList();
    const remaining = shots.slice(1);
    if (remaining.length === 0) return;
    setGenPhase('continuing');
    await runGenerate(remaining);
    setGenPhase('idle');
  }

  // ── Add to Batch (all shots) ──────────────────────────────────────────────
  async function handleAddToBatch() {
    const vp = products.filter(p => p.images && p.images.length > 0 && p.name);
    if (vp.length === 0) return setError('Please add at least one product with an image and name.');
    if (!selectedModel) return setError('Please select a model.');
    if (selectedShots.length === 0 && !includeDetail) return setError('Please select at least one shot type.');

    const shots = buildShotList();
    const modelBase64 = selectedModel.base64;
    const bgBase64Raw = selectedBg?.base64 || null;
    const poseBase64 = selectedPose?.base64 || null;
    let count = 0;

    for (const product of vp) {
      const category = product.category || 'full_outfit';
      const productImages = product.images.map(img => img.base64);
      const offsets = bgBase64Raw && bgIsPanoramic ? spreadOffsets(shots.length) : null;

      for (let si = 0; si < shots.length; si++) {
        const shot = shots[si];
        const isDetail = shot.startsWith('Detail Close-Up');
        const shotType = isDetail ? 'Detail Close-Up' : shot;
        const detailIdx = isDetail && detailNotes.length > 1
          ? parseInt(shot.replace('Detail Close-Up ', '')) - 1 : 0;
        const detailNote = isDetail ? (detailNotes[detailIdx] || detailNotes[0] || '') : '';
        let bgBase64 = bgBase64Raw;
        if (bgBase64Raw && bgIsPanoramic && offsets) bgBase64 = await cropToPotrait(bgBase64Raw, offsets[si]);

        const item = await prepareBatchPDPShotE({
          modelImageBase64: modelBase64,
          productImagesBase64: productImages,
          backgroundImageBase64: bgBase64,
          poseImageBase64: poseBase64,
          shotType, productName: product.name, category,
          modelBodyType: selectedModel?.bodyType || 'Hourglass',
          detailNote, globalInstruction,
          shotInstruction: shotInstructions[shotType] || '',
          quality: 'low', resolution,
          label: `PDP-E — ${product.name} — ${shot}`,
          meta: { model: selectedModel?.name || 'Unknown', background: selectedBg?.name || 'Unknown', category },
        });
        await addToBatchQueue(item);
        count++;
      }
    }
    setBatchAdded(count);
    setTimeout(() => setBatchAdded(0), 3000);
    if (onNavigate) onNavigate('batch');
  }

  function handleCancel() { cancelRef.current = true; setCancelling(true); }

  async function handleApproveOne(key, productName, shotType) {
    const item = results[key];
    if (!item?.base64) return;
    try {
      const filename = `${(productName||'product').replace(/[^a-zA-Z0-9]/g,'_')}_${shotType.replace(/[^a-zA-Z0-9]/g,'_')}_${Date.now()}.png`;
      await window.electronAPI.saveFile(item.base64, filename);
      const filePath = `downloaded/${filename}`;
      await addHistoryEntry({ workflow: 'E', productName, modelId: selectedModel?.id, backgroundId: selectedBg?.id, shotType, outputPath: filePath });
      setResults(prev => ({ ...prev, [key]: { ...prev[key], saved: true, savedPath: filePath } }));
    } catch (e) { setError('Save failed: ' + e.message); }
  }

  async function handleApproveAll() {
    const validProducts = products.filter(p => p.images && p.images.length > 0 && p.name);
    const allShots = buildShotList();
    for (let pi = 0; pi < validProducts.length; pi++) {
      for (const shot of allShots) {
        const key = `${pi}_${shot}`;
        const item = results[key];
        if (item?.status === 'done' && !item.saved) {
          await handleApproveOne(key, validProducts[pi].name, shot);
        }
      }
    }
  }

  const validProducts = products.filter(p => p.images && p.images.length > 0 && p.name);
  const allShots = buildShotList();
  const totalJobs = validProducts.length * allShots.length;
  const doneCount = Object.values(results).filter(r => r.status === 'done').length;

  // ── Render: Setup ─────────────────────────────────────────────────────────
  if (step === 1) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
        <h1>🎯 Smart PDP Shoot</h1>
        <p>Category-aware shots with panoramic background support</p>
      </div>

      <div className="screen-body">
        {error && <div className="alert alert-error">⚠ {error}</div>}

        {/* Step 1: Products */}
        <div className="section-title">
          <span>1. Products (up to 3)</span>
          {products.length < 3 && (
            <button className="btn btn-ghost btn-sm" onClick={addProduct}>+ Add Product</button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 28 }}>
          {products.map((product, i) => (
            <div key={i} className="card">
              <div className="card-body" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 13 }}>Product {i + 1}</span>
                  {products.length > 1 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => removeProduct(i)} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>Remove</button>
                  )}
                </div>
                <input className="form-input" placeholder="Product name (e.g. Black Waistcoat)" value={product.name}
                  onChange={e => updateProduct(i, 'name', e.target.value)} style={{ marginBottom: 8 }} />
                <select className="form-input" value={product.category || 'full_outfit'}
                  onChange={e => updateProduct(i, 'category', e.target.value)} style={{ marginBottom: 10, fontSize: 12 }}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                {product.category && product.category !== 'full_outfit' && (
                  <div style={{ fontSize: 10, color: 'var(--gray-500)', marginBottom: 8, lineHeight: 1.4 }}>
                    {product.category === 'topwear' && '📐 Front/Side/Back cropped head→hip.'}
                    {product.category === 'bottomwear' && '📐 Front/Side/Back cropped waist→feet.'}
                    {product.category === 'innerwear' && '📐 Front/Side/Back cropped head→hip.'}
                    {product.category === 'outerwear' && '📐 Full body shots.'}
                    {product.category === 'footwear' && '📐 Front/Side/Back cropped knee→feet.'}
                  </div>
                )}
                {product.images && product.images.length > 0 ? (
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                      {product.images.map((img, j) => (
                        <div key={j} style={{ position: 'relative' }}>
                          <img src={img.base64} alt="" style={{ width: 60, height: 80, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                          <button onClick={() => removeProductImage(i, j)}
                            style={{ position: 'absolute', top: -4, right: -4, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>
                      ))}
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ width: '100%', fontSize: 11 }} onClick={() => handleProductPick(i)}>+ Add more angles</button>
                  </div>
                ) : (
                  <div className="upload-zone" style={{ padding: 20 }} onClick={() => handleProductPick(i)}>
                    <span className="upload-zone-icon" style={{ fontSize: 28 }}>📦</span>
                    <div className="upload-zone-text">Click to upload (select multiple)</div>
                    <div className="upload-zone-text" style={{ fontSize: 11, color: 'var(--gray-500)' }}>Front, side, back, detail — all help</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Step 2: Select Model */}
        <div className="section-title">2. Select Model</div>
        {models.length === 0 ? (
          <div className="alert alert-info" style={{ marginBottom: 24 }}>Add models in Model Library first.</div>
        ) : (
          <div className="grid-4" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {models.map(m => (
              <div key={m.id} className={`image-card ${selectedModel?.id === m.id ? 'selected' : ''}`}
                onClick={() => setSelectedModel(m)} style={{ cursor: 'pointer' }}>
                {m.base64 ? <img src={m.base64} alt={m.name} className="image-card-thumb" />
                  : <div className="image-card-thumb-placeholder">👤</div>}
                <div className="image-card-info"><div className="image-card-name">{m.name}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* Step 3: Select Background */}
        <div className="section-title">
          3. Select Background
          {bgIsPanoramic && (
            <span style={{ fontSize: 10, background: 'rgba(201,168,76,0.15)', color: 'var(--gold)', borderRadius: 4, padding: '2px 6px', marginLeft: 8 }}>
              🌅 Panoramic — auto-cropped per shot
            </span>
          )}
        </div>
        {backgrounds.length === 0 ? (
          <div className="alert alert-info" style={{ marginBottom: 24 }}>Add backgrounds in Background Library first.</div>
        ) : (
          <div className="grid-4" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {backgrounds.map(bg => (
              <div key={bg.id} className={`image-card ${selectedBg?.id === bg.id ? 'selected' : ''}`}
                onClick={() => handleSelectBg(bg)} style={{ cursor: 'pointer' }}>
                {bg.base64 ? <img src={bg.base64} alt={bg.name} className="image-card-thumb" />
                  : <div className="image-card-thumb-placeholder">🖼</div>}
                <div className="image-card-info"><div className="image-card-name">{bg.name}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* Step 4: Styled Pose */}
        <div className="section-title">
          4. Styled Pose (Optional)
          {selectedPose && <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setSelectedPose(null)}>✕ Clear</button>}
        </div>
        {poses.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 24 }}>Add poses in Pose Library to use this feature.</div>
        ) : (
          <div className="grid-4" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {poses.map(p => (
              <div key={p.id} className={`image-card ${selectedPose?.id === p.id ? 'selected' : ''}`}
                onClick={() => setSelectedPose(selectedPose?.id === p.id ? null : p)} style={{ cursor: 'pointer' }}>
                {p.base64 ? <img src={p.base64} alt={p.name} className="image-card-thumb" />
                  : <div className="image-card-thumb-placeholder">🧍</div>}
                <div className="image-card-info"><div className="image-card-name">{p.name}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* Step 5: Shot Types */}
        <div className="section-title">5. Shot Types & Instructions</div>
        <div style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
          <div>
            {BASE_SHOT_TYPES.map(shot => (
              <div key={shot.id} style={{ marginBottom: 12 }}>
                <label className="checkbox-item" style={{ marginBottom: selectedShots.includes(shot.id) ? 6 : 0 }}>
                  <input type="checkbox" checked={selectedShots.includes(shot.id)} onChange={() => toggleShot(shot.id)} />
                  <div>
                    <div className="checkbox-item-label">{shot.label}</div>
                    <div className="checkbox-item-sub">{shot.sub}</div>
                  </div>
                </label>
                {selectedShots.includes(shot.id) && (
                  <div style={{ marginLeft: 28 }}>
                    <input className="form-input" placeholder={`Instruction for ${shot.label} (optional)`}
                      value={shotInstructions[shot.id] || ''}
                      onChange={e => setShotInstructions(prev => ({ ...prev, [shot.id]: e.target.value }))}
                      style={{ fontSize: 11 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div>
            <div style={{ borderLeft: '1px solid var(--gray-200)', paddingLeft: 24 }}>
              <label className="checkbox-item" style={{ marginBottom: includeDetail ? 8 : 0 }}>
                <input type="checkbox" checked={includeDetail} onChange={e => setIncludeDetail(e.target.checked)} />
                <div>
                  <div className="checkbox-item-label">Detail Close-Up</div>
                  <div className="checkbox-item-sub">One or more zoom-in shots</div>
                </div>
              </label>
              {includeDetail && (
                <div style={{ marginLeft: 28 }}>
                  {detailNotes.map((note, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input className="form-input" placeholder="Zoom into: e.g. puff sleeve, ruffle hem"
                        value={note} onChange={e => updateDetailNote(idx, e.target.value)}
                        style={{ fontSize: 11, flex: 1 }} />
                      {detailNotes.length > 1 && (
                        <button onClick={() => removeDetailNote(idx)}
                          style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                      )}
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={addDetailNote} style={{ fontSize: 11, marginTop: 2 }}>+ Add another detail shot</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Global instruction */}
        <div style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ fontSize: 12 }}>Global Instruction — applies to all shots</label>
          <input className="form-input" placeholder="e.g. model should have loose open hair, outdoor daylight mood"
            value={globalInstruction} onChange={e => setGlobalInstruction(e.target.value)} style={{ fontSize: 12 }} />
        </div>

        {/* Summary + Options + Buttons */}
        <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--navy)' }}>
          <strong>{validProducts.length}</strong> product{validProducts.length !== 1 ? 's' : ''} × <strong>{allShots.length}</strong> shot{allShots.length !== 1 ? 's' : ''} = <strong>{totalJobs}</strong> image{totalJobs !== 1 ? 's' : ''}
          {bgIsPanoramic && <span style={{ color: 'var(--gold)', marginLeft: 8, fontSize: 11 }}>· unique bg crop per shot</span>}
        </div>

        <GenerationOptions resolution={resolution} onResolutionChange={setResolution} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-gold btn-lg" style={{ flex: 1 }} onClick={handleAddToBatch}
            disabled={generating || validProducts.length === 0 || !selectedModel}>
            <div>
              {batchAdded > 0 ? `✓ ${batchAdded} queued` : '📦 Add to Batch'}
              <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>
                {totalJobs > 0 ? `${totalJobs} credit${totalJobs !== 1 ? 's' : ''}` : '1 credit/image'}
              </div>
            </div>
          </button>

          {generating ? (
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled>
              <div><span className="spinner" /> Generating…</div>
            </button>
          ) : genPhase === 'preview_done' ? (
            <div style={{ flex: 1, border: '1px solid #48bb78', borderRadius: 10, padding: '10px 14px', background: 'rgba(72,187,120,0.08)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>
                ✓ Front done! Continue with {allShots.length - 1} more shot{allShots.length - 1 !== 1 ? 's' : ''}?
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleContinueGenerating}>
                  ▶ Continue ({(allShots.length - 1) * validProducts.length * 3} credits)
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setGenPhase('idle')}>Done</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={handleGeneratePreview}
              disabled={validProducts.length === 0 || !selectedModel || !selectedBg}>
              <div>
                ✨ Preview Front Shot
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>
                  {validProducts.length > 0 ? `${validProducts.length * 3} credits` : '3 credits/image'}
                </div>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Render: Results ───────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <button className="back-btn" onClick={() => setStep(1)}>← Back to Setup</button>
            <h1>🎯 Smart PDP Shoot — Results</h1>
            <p>{doneCount} of {progress.total} generated</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {generating && (
              <button
                className="btn btn-outline"
                onClick={handleCancel}
                disabled={cancelling}
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
              >
                {cancelling ? '⏳ Stopping…' : '⏹ Stop after current'}
              </button>
            )}
            {!generating && doneCount > 0 && (
              <button className="btn btn-primary" onClick={handleApproveAll}>⬇ Save All Approved</button>
            )}
          </div>
        </div>
      </div>

      <div className="screen-body">
        {error && <div className="alert alert-error">⚠ {error}</div>}

        {genPhase === 'preview_done' && !generating && (
          <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid #48bb78', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>
              ✓ Front shot{validProducts.length !== 1 ? 's' : ''} done! Continue with the remaining {allShots.length - 1} shot{allShots.length - 1 !== 1 ? 's' : ''}?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleContinueGenerating}>
                ▶ Continue ({(allShots.length - 1) * validProducts.length * 3} credits)
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setGenPhase('idle')}>No, I'm done</button>
            </div>
          </div>
        )}

        {geminiError && (
          <div style={{ background: 'rgba(220,100,0,0.08)', border: '1px solid #e07020', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: '#a04000', marginBottom: 4 }}>🔮 Gemini failed</div>
            <div style={{ fontSize: 12, color: '#a04000', marginBottom: 10 }}>{geminiError}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { skipGeminiRef.current = true; setGeminiError(''); handleGeneratePreview(); }}>Use OpenAI instead</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setGeminiError('')}>Dismiss</button>
            </div>
          </div>
        )}

        {generating && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
              <span className="status-generating"><span className="spinner spinner-dark" style={{ width: 14, height: 14 }} /> Generating…</span>
              <span style={{ color: 'var(--gray-500)' }}>{progress.done} / {progress.total}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
            </div>
          </div>
        )}

        {validProducts.map((product, pi) => (
          <div key={pi} style={{ marginBottom: 32 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)', marginBottom: 12 }}>
              {product.name}
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-500)', marginLeft: 8 }}>
                {CATEGORIES.find(c => c.id === (product.category || 'full_outfit'))?.label}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
              {allShots.map(shot => {
                const key = `${pi}_${shot}`;
                const item = results[key] || { status: 'idle' };
                return (
                  <div key={shot} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--gray-200)', background: '#fff' }}>
                    <div style={{ aspectRatio: '2/3', background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      {item.status === 'done' && item.base64 && (
                        <img src={item.base64} alt={shot} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      {item.status === 'generating' && (
                        <div style={{ textAlign: 'center' }}>
                          <span className="spinner" style={{ width: 28, height: 28 }} />
                          <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 6 }}>Generating…</div>
                        </div>
                      )}
                      {item.status === 'error' && (
                        <div style={{ textAlign: 'center', padding: 8 }}>
                          <div style={{ fontSize: 20 }}>⚠</div>
                          <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 4 }}>{item.error?.slice(0, 60)}</div>
                        </div>
                      )}
                      {item.status === 'idle' && (
                        <span style={{ fontSize: 28, opacity: 0.3 }}>📷</span>
                      )}
                      {item.saved && (
                        <div style={{ position: 'absolute', top: 4, right: 4, background: 'var(--green)', color: '#fff', borderRadius: 4, fontSize: 9, padding: '2px 5px' }}>✓ Saved</div>
                      )}
                    </div>
                    <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--gray-600)', fontWeight: 600 }}>{shot}</span>
                      {item.status === 'done' && item.base64 && !item.saved && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: 9, padding: '2px 7px' }}
                          onClick={() => handleApproveOne(key, product.name, shot)}
                        >Save</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
