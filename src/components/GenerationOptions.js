import React, { useState, useEffect } from 'react';
import { RESOLUTION_PRESETS } from '../utils/constants';

const GROUPED_PRESETS = RESOLUTION_PRESETS.reduce((acc, r) => {
  const g = r.group || 'Other';
  if (!acc[g]) acc[g] = [];
  acc[g].push(r);
  return acc;
}, {});
const GROUP_ORDER = ['Portrait', 'Square', 'Landscape', 'Native', 'Custom'];

export default function GenerationOptions({ resolution, onResolutionChange }) {
  const isCustom = resolution === 'custom' || (resolution && resolution.startsWith('custom:'));
  const [customW, setCustomW] = useState(() =>
    resolution?.startsWith('custom:') ? resolution.replace('custom:', '').split('x')[0] : '1080'
  );
  const [customH, setCustomH] = useState(() =>
    resolution?.startsWith('custom:') ? resolution.replace('custom:', '').split('x')[1] : '1440'
  );

  useEffect(() => {
    if (resolution?.startsWith('custom:')) {
      const [w, h] = resolution.replace('custom:', '').split('x');
      setCustomW(w || '1080');
      setCustomH(h || '1440');
    }
  }, [resolution]);

  function handleSelectChange(val) {
    if (val === 'custom') {
      onResolutionChange('custom:' + customW + 'x' + customH);
    } else {
      onResolutionChange(val);
    }
  }

  function handleCustomChange(w, h) {
    if (w && h && Number(w) > 0 && Number(h) > 0) {
      onResolutionChange('custom:' + w + 'x' + h);
    }
  }

  const selectValue = isCustom ? 'custom' : resolution;

  return (
    <div style={{
      background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
      borderRadius: 8, padding: '10px 14px', marginBottom: 16,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
        ⚙️ Output Options
      </div>
      <div>
        <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>Resolution</label>
        <select
          className="form-select"
          style={{ fontSize: 11, padding: '5px 6px', height: 32, width: '100%' }}
          value={selectValue}
          onChange={e => handleSelectChange(e.target.value)}
        >
          {GROUP_ORDER.filter(g => GROUPED_PRESETS[g]).map(group => (
            <optgroup key={group} label={group}>
              {GROUPED_PRESETS[group].map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {isCustom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <input type="number" min="100" max="4096" value={customW}
              onChange={e => { setCustomW(e.target.value); handleCustomChange(e.target.value, customH); }}
              style={{ flex: 1, padding: '4px 6px', fontSize: 11, border: '1px solid var(--gray-300)', borderRadius: 5, textAlign: 'center' }}
              placeholder="W" />
            <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>×</span>
            <input type="number" min="100" max="4096" value={customH}
              onChange={e => { setCustomH(e.target.value); handleCustomChange(customW, e.target.value); }}
              style={{ flex: 1, padding: '4px 6px', fontSize: 11, border: '1px solid var(--gray-300)', borderRadius: 5, textAlign: 'center' }}
              placeholder="H" />
            <span style={{ fontSize: 9, color: 'var(--gray-500)' }}>px</span>
          </div>
        )}
      </div>
    </div>
  );
}
