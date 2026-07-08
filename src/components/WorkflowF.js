import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getModels, getBackgrounds, getPoses, getSettings, saveSettings } from '../utils/storage';
import { prepareBatchFabricShotF, tileSwatch, getPromptTemplates } from '../utils/api';
import { addManyToBatchQueue } from '../utils/batchQueue';
import GenerationOptions from './GenerationOptions';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

const CATEGORIES = [
  { id: 'full_outfit', label: 'Full Outfit' },
  { id: 'topwear',    label: 'Topwear' },
  { id: 'bottomwear', label: 'Bottomwear' },
  { id: 'innerwear',  label: 'Innerwear' },
  { id: 'outerwear',  label: 'Outerwear' },
  { id: 'footwear',   label: 'Footwear' },
];

const SHOT_TYPES = [
  { id: 'Front',  label: 'Front',          sub: 'Full / Focused Body' },
  { id: 'Styled', label: 'Styled',         sub: 'Editorial — always full body' },
  { id: 'Side',   label: 'Side',           sub: 'Full / Focused Body' },
  { id: 'Back',   label: 'Back',           sub: 'Full / Focused Body' },
];

// ── Swatch tiling canvas ──────────────────────────────────────────────────
function SwatchPanel({ onSwatchReady }) {
  const [swatchBase64, setSwatchBase64] = useState(null);
  const [swatchName, setSwatchName] = useState('');
  const [imgNaturalW, setImgNaturalW] = useState(0);
  const [imgNaturalH, setImgNaturalH] = useState(0);

  // Repeat size in natural image pixels
  const [repeatW, setRepeatW] = useState(0);
  const [repeatH, setRepeatH] = useState(0);

  // Canvas drag state (display coords)
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [rectDisplay, setRectDisplay] = useState(null); // { x, y, w, h } in display px

  // Preview tiling
  const [tiledBase64, setTiledBase64] = useState(null);
  const [tiling, setTiling] = useState(false);
  const [tileError, setTileError] = useState('');

  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const displayScaleRef = useRef({ sx: 1, sy: 1 }); // naturalPx / displayPx

  // Draw rect on canvas
  const drawRect = useCallback((rect) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (rect) {
      ctx.strokeStyle = '#c9a84c';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = 'rgba(201,168,76,0.12)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, []);

  async function handleSwatchPick() {
    const paths = await window.electronAPI.openMultipleFilesDialog();
    if (!paths || paths.length === 0) return;
    const b64 = await window.electronAPI.readFileAsBase64(paths[0]);
    const name = paths[0].split(/[\\/]/).pop();
    setSwatchBase64(b64);
    setSwatchName(name);
    setRectDisplay(null);
    setRepeatW(0);
    setRepeatH(0);
    setTiledBase64(null);
    setTileError('');
    onSwatchReady(null, 0, 0);

    // Get natural dimensions
    const img = new Image();
    img.onload = () => {
      setImgNaturalW(img.naturalWidth);
      setImgNaturalH(img.naturalHeight);
    };
    img.src = b64;
  }

  // Once image loaded into canvas, set scale
  function handleImgLoad(e) {
    const img = e.target;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = img.width;
    canvas.height = img.height;
    displayScaleRef.current = {
      sx: imgNaturalW / img.width,
      sy: imgNaturalH / img.height,
    };
    drawRect(rectDisplay);
  }

  function getCanvasXY(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e) {
    if (!swatchBase64) return;
    const pt = getCanvasXY(e);
    setDragging(true);
    setDragStart(pt);
    setRectDisplay({ x: pt.x, y: pt.y, w: 0, h: 0 });
  }

  function onMouseMove(e) {
    if (!dragging || !dragStart) return;
    const pt = getCanvasXY(e);
    const r = {
      x: Math.min(dragStart.x, pt.x),
      y: Math.min(dragStart.y, pt.y),
      w: Math.abs(pt.x - dragStart.x),
      h: Math.abs(pt.y - dragStart.y),
    };
    setRectDisplay(r);
    drawRect(r);
  }

  function onMouseUp() {
    if (!dragging) return;
    setDragging(false);
    if (rectDisplay && rectDisplay.w > 4 && rectDisplay.h > 4) {
      const sc = displayScaleRef.current;
      const nW = Math.round(rectDisplay.w * sc.sx);
      const nH = Math.round(rectDisplay.h * sc.sy);
      setRepeatW(nW);
      setRepeatH(nH);
      onSwatchReady(null, 0, 0); // reset tiled until re-tiled
      setTiledBase64(null);
    }
  }

  async function handleTile() {
    if (!swatchBase64 || repeatW < 4 || repeatH < 4) return;
    setTiling(true);
    setTileError('');
    try {
      const tiled = await tileSwatch(swatchBase64, repeatW, repeatH);
      setTiledBase64(tiled);
      onSwatchReady(swatchBase64, repeatW, repeatH);
    } catch (e) {
      setTileError(e.message);
    }
    setTiling(false);
  }

  // Keep canvas in sync with rectDisplay changes (e.g., from number inputs)
  useEffect(() => {
    if (swatchBase64) drawRect(rectDisplay);
  }, [rectDisplay, swatchBase64, drawRect]);

  function handleRepeatWInput(val) {
    const n = Math.max(1, Math.min(parseInt(val) || 1, imgNaturalW));
    setRepeatW(n);
    setTiledBase64(null);
    onSwatchReady(null, 0, 0);
    // Recalculate display rect from natural coords
    if (rectDisplay && imgNaturalW > 0) {
      const sc = displayScaleRef.current;
      const newW = n / sc.sx;
      const newRect = { ...rectDisplay, w: newW };
      setRectDisplay(newRect);
    }
  }

  function handleRepeatHInput(val) {
    const n = Math.max(1, Math.min(parseInt(val) || 1, imgNaturalH));
    setRepeatH(n);
    setTiledBase64(null);
    onSwatchReady(null, 0, 0);
    if (rectDisplay && imgNaturalH > 0) {
      const sc = displayScaleRef.current;
      const newH = n / sc.sy;
      const newRect = { ...rectDisplay, h: newH };
      setRectDisplay(newRect);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {/* Left: swatch upload + canvas drag */}
      <div style={{ flex: '1 1 280px' }}>
        {!swatchBase64 ? (
          <div className="upload-zone" style={{ padding: 28 }} onClick={handleSwatchPick}>
            <span className="upload-zone-icon" style={{ fontSize: 32 }}>🧵</span>
            <div className="upload-zone-text">Click to upload swatch image</div>
            <div className="upload-zone-text" style={{ fontSize: 11, color: 'var(--gray-500)' }}>Any fabric / pattern photo</div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--gray-600)', fontWeight: 500 }}>{swatchName}</span>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={handleSwatchPick}>↩ Change</button>
            </div>
            <div style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none' }}>
              <img
                ref={imgRef}
                src={swatchBase64}
                alt="swatch"
                style={{ display: 'none' }}
                onLoad={handleImgLoad}
              />
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 'auto', borderRadius: 6, border: '1px solid var(--gray-200)', display: 'block' }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 4, textAlign: 'center' }}>
              Drag to select one repeat unit
            </div>
            {/* Numeric inputs */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--gray-600)' }}>Repeat W (px)</label>
                <input className="form-input" type="number" min={1} max={imgNaturalW}
                  value={repeatW || ''} onChange={e => handleRepeatWInput(e.target.value)}
                  style={{ fontSize: 12 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--gray-600)' }}>Repeat H (px)</label>
                <input className="form-input" type="number" min={1} max={imgNaturalH}
                  value={repeatH || ''} onChange={e => handleRepeatHInput(e.target.value)}
                  style={{ fontSize: 12 }} />
              </div>
              <div style={{ paddingTop: 16 }}>
                <button className="btn btn-primary btn-sm" onClick={handleTile}
                  disabled={tiling || repeatW < 4 || repeatH < 4}>
                  {tiling ? <span className="spinner" /> : '↺ Tile'}
                </button>
              </div>
            </div>
            {tileError && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {tileError}</div>}
          </div>
        )}
      </div>

      {/* Right: tiling preview */}
      <div style={{ flex: '1 1 200px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy)', marginBottom: 6 }}>Tiling Preview</div>
        {tiledBase64 ? (
          <div>
            <img src={tiledBase64} alt="tiled preview" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--gray-200)', display: 'block' }} />
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 4, textAlign: 'center' }}>
              1024×1024 tiled — this image goes to Gemini
            </div>
          </div>
        ) : (
          <div style={{ height: 160, border: '1px dashed var(--gray-300)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
              {swatchBase64 ? (repeatW >= 4 && repeatH >= 4 ? 'Press ↺ Tile to preview' : 'Select repeat area first') : 'Upload swatch first'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main WorkflowF component ──────────────────────────────────────────────
export default function WorkflowF({ onBack, onNavigate }) {
  const [product, setProduct] = useState({ name: '', images: [], category: 'full_outfit' });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [backgrounds, setBackgrounds] = useState([]);
  const [selectedBg, setSelectedBg] = useState(null);
  const [poses, setPoses] = useState([]);
  const [selectedPose, setSelectedPose] = useState(null);

  const [selectedShots, setSelectedShots] = useState(['Front', 'Styled', 'Side', 'Back']);
  const [includeDetail, setIncludeDetail] = useState(false);
  const [detailNote, setDetailNote] = useState('');

  const [lightingPresets, setLightingPresets] = useState([]);
  const [lightingPresetId, setLightingPresetId] = useState('studio_soft');
  const [globalInstruction, setGlobalInstruction] = useState('');
  const [resolution, setResolution] = useState('1080x1440');

  // Swatch state — set by SwatchPanel
  const [swatchBase64, setSwatchBase64] = useState(null);
  const [swatchRepeatW, setSwatchRepeatW] = useState(0);
  const [swatchRepeatH, setSwatchRepeatH] = useState(0);

  const [adding, setAdding] = useState(false);
  const [batchAdded, setBatchAdded] = useState(0);
  const addingRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getModels().then(setModels);
    getBackgrounds().then(setBackgrounds);
    getPoses().then(setPoses);
    getSettings().then(s => {
      setResolution(s.defaultResolution || '1080x1440');
      if (s.fabricLightingPresetId) setLightingPresetId(s.fabricLightingPresetId);
    });
    getPromptTemplates().then(t => {
      if (t.lighting_presets?.length) setLightingPresets(t.lighting_presets);
    });
  }, []);

  // Auto-save lighting preference
  const prefMounted = useRef(false);
  useEffect(() => {
    if (!prefMounted.current) { prefMounted.current = true; return; }
    const t = setTimeout(() => {
      getSettings().then(s => saveSettings({ ...s, fabricLightingPresetId: lightingPresetId }));
    }, 1000);
    return () => clearTimeout(t);
  }, [lightingPresetId]);

  function handleSwatchReady(base64, rW, rH) {
    setSwatchBase64(base64);
    setSwatchRepeatW(rW);
    setSwatchRepeatH(rH);
  }

  async function handleProductPick() {
    const paths = await window.electronAPI.openMultipleFilesDialog();
    if (!paths || paths.length === 0) return;
    const newImages = await Promise.all(paths.map(async p => ({
      file: p,
      base64: await window.electronAPI.readFileAsBase64(p),
      name: p.split(/[\\/]/).pop(),
    })));
    setProduct(prev => ({ ...prev, images: [...prev.images, ...newImages] }));
  }

  function removeProductImage(idx) {
    setProduct(prev => ({ ...prev, images: prev.images.filter((_, j) => j !== idx) }));
  }

  function toggleShot(id) {
    setSelectedShots(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }

  function buildShotList() {
    const shots = [...selectedShots];
    if (includeDetail) shots.push('Detail Close-Up');
    return shots;
  }

  async function handleAddToBatch() {
    if (addingRef.current) return;

    // Validate
    if (!product.images.length || !product.name) return setError('Please add a product image and name.');
    if (!selectedModel) return setError('Please select a model.');
    if (!swatchBase64) return setError('Please upload and tile a swatch first.');
    const shots = buildShotList();
    if (!shots.length) return setError('Please select at least one shot type.');
    setError('');

    addingRef.current = true;
    setAdding(true);

    try {
      const settings = await getSettings();

      // Tile the swatch server-side now (using stored repeat dims)
      let tiledBase64;
      try {
        tiledBase64 = await tileSwatch(swatchBase64, swatchRepeatW, swatchRepeatH);
      } catch (e) {
        setError('Swatch tiling failed: ' + e.message);
        addingRef.current = false;
        setAdding(false);
        return;
      }

      const allItems = await Promise.all(shots.map(shot => {
        const isDetail = shot === 'Detail Close-Up';
        return prepareBatchFabricShotF({
          modelImageBase64: selectedModel.base64,
          productImagesBase64: product.images.map(i => i.base64),
          backgroundImageBase64: selectedBg?.base64 || null,
          poseImageBase64: selectedPose?.base64 || null,
          swatchTiledBase64: tiledBase64,
          shotType: shot,
          productName: product.name,
          category: product.category || 'full_outfit',
          modelBodyType: selectedModel?.bodyType || 'Hourglass',
          globalInstruction,
          shotInstruction: isDetail && detailNote ? `CROP AREA: Show ONLY from ${detailNote} — frame tightly.` : '',
          quality: 'low',
          resolution,
          lightingPresetId,
          label: `Fabric Swap — ${product.name} — ${shot}`,
          meta: {
            model: selectedModel?.name || 'Unknown',
            background: selectedBg?.name || 'None',
            pose: selectedPose?.name || 'None',
            category: product.category || 'full_outfit',
            swatchRepeatW,
            swatchRepeatH,
          },
          _settings: settings,
        });
      }));

      await addManyToBatchQueue(allItems);
      setBatchAdded(allItems.length);
      setTimeout(() => setBatchAdded(0), 3000);
      if (onNavigate) onNavigate('batch');
    } catch (e) {
      setError(e.message);
    }

    addingRef.current = false;
    setAdding(false);
  }

  const shots = buildShotList();
  const isReady = product.images.length > 0 && product.name && selectedModel && swatchBase64;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
        <h1>🧵 Fabric Swap</h1>
        <p>Replace the fabric or print on any garment — same construction, new pattern</p>
      </div>

      <div className="screen-body">
        {error && <div className="alert alert-error">⚠ {error}</div>}

        {/* 1. Product */}
        <div className="section-title">1. Product</div>
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-body" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <input className="form-input" placeholder="Product name" value={product.name}
                onChange={e => setProduct(p => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
              <select className="form-input" value={product.category}
                onChange={e => setProduct(p => ({ ...p, category: e.target.value }))} style={{ width: 140, fontSize: 12 }}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            {product.images.length > 0 ? (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {product.images.map((img, j) => (
                    <div key={j} style={{ position: 'relative' }}>
                      <img src={img.base64} alt="" style={{ width: 60, height: 80, objectFit: 'cover', borderRadius: 4 }} />
                      <button onClick={() => removeProductImage(j)}
                        style={{ position: 'absolute', top: -4, right: -4, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', fontSize: 11 }} onClick={handleProductPick}>+ Add more angles</button>
              </div>
            ) : (
              <div className="upload-zone" style={{ padding: 20 }} onClick={handleProductPick}>
                <span className="upload-zone-icon" style={{ fontSize: 28 }}>📦</span>
                <div className="upload-zone-text">Click to upload (select multiple)</div>
                <div className="upload-zone-text" style={{ fontSize: 11, color: 'var(--gray-500)' }}>Front, side, back — all help</div>
              </div>
            )}
          </div>
        </div>

        {/* 2. Model */}
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

        {/* 3. Background */}
        <div className="section-title">3. Select Background</div>
        {backgrounds.length === 0 ? (
          <div className="alert alert-info" style={{ marginBottom: 24 }}>Add backgrounds in Background Library first.</div>
        ) : (
          <div className="grid-4" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {backgrounds.map(bg => (
              <div key={bg.id} className={`image-card ${selectedBg?.id === bg.id ? 'selected' : ''}`}
                onClick={() => setSelectedBg(selectedBg?.id === bg.id ? null : bg)} style={{ cursor: 'pointer' }}>
                {bg.base64 ? <img src={bg.base64} alt={bg.name} className="image-card-thumb" />
                  : <div className="image-card-thumb-placeholder">🖼</div>}
                <div className="image-card-info"><div className="image-card-name">{bg.name}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* 4. Pose (optional) */}
        <div className="section-title">
          4. Pose (Optional)
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

        {/* 5. Fabric Swatch */}
        <div className="section-title">5. Fabric Swatch</div>
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-body" style={{ padding: 14 }}>
            <SwatchPanel onSwatchReady={handleSwatchReady} />
            {swatchBase64 && swatchRepeatW >= 4 && swatchRepeatH >= 4 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#48bb78', fontWeight: 500 }}>
                ✓ Swatch ready — {swatchRepeatW}×{swatchRepeatH}px repeat
              </div>
            )}
          </div>
        </div>

        {/* 6. Shot Types */}
        <div className="section-title">6. Shot Types</div>
        <div style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
          <div>
            {SHOT_TYPES.map(shot => (
              <label key={shot.id} className="checkbox-item" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={selectedShots.includes(shot.id)} onChange={() => toggleShot(shot.id)} />
                <div>
                  <div className="checkbox-item-label">{shot.label}</div>
                  <div className="checkbox-item-sub">{shot.sub}</div>
                </div>
              </label>
            ))}
          </div>
          <div>
            <div style={{ borderLeft: '1px solid var(--gray-200)', paddingLeft: 24 }}>
              <label className="checkbox-item" style={{ marginBottom: includeDetail ? 8 : 0 }}>
                <input type="checkbox" checked={includeDetail} onChange={e => setIncludeDetail(e.target.checked)} />
                <div>
                  <div className="checkbox-item-label">Detail Close-Up</div>
                  <div className="checkbox-item-sub">Tight fabric/pattern zoom</div>
                </div>
              </label>
              {includeDetail && (
                <div style={{ marginLeft: 28 }}>
                  <input className="form-input" placeholder="e.g. neckline, sleeve cuff, hem detail"
                    value={detailNote} onChange={e => setDetailNote(e.target.value)}
                    style={{ fontSize: 11 }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 7. Lighting */}
        {lightingPresets.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label className="form-label" style={{ fontSize: 12 }}>7. Lighting &amp; Shadow — applies to all shots</label>
            <select className="form-input" value={lightingPresetId} onChange={e => setLightingPresetId(e.target.value)} style={{ fontSize: 12 }}>
              {lightingPresets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Global instruction */}
        <div style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ fontSize: 12 }}>Global Instruction (optional)</label>
          <input className="form-input" placeholder="e.g. model should have loose open hair"
            value={globalInstruction} onChange={e => setGlobalInstruction(e.target.value)} style={{ fontSize: 12 }} />
        </div>

        {/* Summary */}
        <div style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--navy)' }}>
          <strong>1</strong> product × <strong>{shots.length}</strong> shot{shots.length !== 1 ? 's' : ''} = <strong>{shots.length}</strong> image{shots.length !== 1 ? 's' : ''}
        </div>

        <GenerationOptions resolution={resolution} onResolutionChange={setResolution} />

        <button className="btn btn-gold btn-lg" style={{ width: '100%' }} onClick={handleAddToBatch}
          disabled={adding || !isReady}>
          <div>
            {adding ? <><span className="spinner" /> Preparing…</> : batchAdded > 0 ? `✓ ${batchAdded} queued` : '📦 Add to Batch'}
            {!adding && <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>
              {shots.length > 0 ? `${shots.length} credit${shots.length !== 1 ? 's' : ''}` : '1 credit/image'}
            </div>}
          </div>
        </button>

        {!swatchBase64 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gray-500)', textAlign: 'center' }}>
            Upload and tile a swatch to enable batch
          </div>
        )}
        {swatchBase64 && (swatchRepeatW < 4 || swatchRepeatH < 4) && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gold)', textAlign: 'center' }}>
            Select a repeat area on the swatch and press ↺ Tile
          </div>
        )}
      </div>
    </div>
  );
}
