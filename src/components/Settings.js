import React, { useState, useEffect, useRef } from 'react';
import { getSettings, saveSettings } from '../utils/storage';
import { RESOLUTION_PRESETS } from '../utils/constants';

const GROUPED_PRESETS = RESOLUTION_PRESETS.reduce((acc, r) => {
  const g = r.group || 'Other';
  if (!acc[g]) acc[g] = [];
  acc[g].push(r);
  return acc;
}, {});
const GROUP_ORDER = ['Portrait', 'Square', 'Landscape', 'Native', 'Custom'];

export default function Settings() {
  const [quality, setQuality] = useState('high');
  const [resolution, setResolution] = useState('1080x1440');
  const [customW, setCustomW] = useState('1080');
  const [customH, setCustomH] = useState('1440');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autoSaveTimer = useRef(null);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    const s = await getSettings();
    setQuality(s.defaultQuality || 'high');
    const res = s.defaultResolution || '1080x1440';
    setResolution(res);
    if (res && res.startsWith('custom:')) {
      const [w, h] = res.replace('custom:', '').split('x');
      setCustomW(w || '1080');
      setCustomH(h || '1440');
    }
  }

  function scheduleAutoSave(qual, res) {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doSave(qual, res), 800);
  }

  function handleQualityChange(val) {
    setQuality(val);
    scheduleAutoSave(val, resolution);
  }

  function handleResolutionChange(val) {
    if (val === 'custom') {
      const encoded = `custom:${customW}x${customH}`;
      setResolution(encoded);
      scheduleAutoSave(quality, encoded);
    } else {
      setResolution(val);
      scheduleAutoSave(quality, val);
    }
  }

  function handleCustomDimChange(w, h) {
    setCustomW(w);
    setCustomH(h);
    if (w && h && Number(w) > 0 && Number(h) > 0) {
      const encoded = `custom:${w}x${h}`;
      setResolution(encoded);
      scheduleAutoSave(quality, encoded);
    }
  }

  async function doSave(qual, res) {
    await saveSettings({ defaultQuality: qual, defaultResolution: res || resolution });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleManualSave() {
    clearTimeout(autoSaveTimer.current);
    setSaving(true);
    await doSave(quality, resolution);
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Settings</h1>
            <p>Generation quality and resolution defaults</p>
          </div>
          {saved && <span className="status-done" style={{ fontSize: 13 }}>✓ Saved</span>}
        </div>
      </div>

      <div className="screen-body" style={{ maxWidth: 560 }}>

        <div className="alert alert-info" style={{ marginBottom: 24, fontSize: 12 }}>
          💡 API keys are managed in <strong>Admin Panel → API Keys</strong>
        </div>

        {/* Quality + Resolution */}
        <div className="card mb-24">
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 20 }}>✨</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>Generation Defaults</span>
            </div>

            <div className="form-group">
              <label className="form-label">Default Quality</label>
              <select className="form-select" value={quality} onChange={e => handleQualityChange(e.target.value)}>
                <option value="high">High — best results (~₹18–28 / image)</option>
                <option value="medium">Medium — balanced (~₹11–16 / image)</option>
                <option value="low">Low — fast / testing (~₹2–4 / image)</option>
              </select>
              <p style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>
                Can be overridden per-session in each workflow.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Default Output Resolution</label>
              <select
                className="form-select"
                value={resolution && resolution.startsWith('custom:') ? 'custom' : resolution}
                onChange={e => handleResolutionChange(e.target.value)}
              >
                {GROUP_ORDER.filter(g => GROUPED_PRESETS[g]).map(group => (
                  <optgroup key={group} label={group}>
                    {GROUPED_PRESETS[group].map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {(resolution === 'custom' || (resolution && resolution.startsWith('custom:'))) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input
                    type="number" min="100" max="4096" value={customW}
                    onChange={e => handleCustomDimChange(e.target.value, customH)}
                    style={{ width: 80, padding: '5px 8px', fontSize: 12, border: '1px solid var(--gray-300)', borderRadius: 5 }}
                    placeholder="Width"
                  />
                  <span style={{ color: 'var(--gray-500)' }}>×</span>
                  <input
                    type="number" min="100" max="4096" value={customH}
                    onChange={e => handleCustomDimChange(customW, e.target.value)}
                    style={{ width: 80, padding: '5px 8px', fontSize: 12, border: '1px solid var(--gray-300)', borderRadius: 5 }}
                    placeholder="Height"
                  />
                  <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>pixels</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <button className="btn btn-primary btn-lg" onClick={handleManualSave} disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Settings'}
        </button>
      </div>
    </div>
  );
}
