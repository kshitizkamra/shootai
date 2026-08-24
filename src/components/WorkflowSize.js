import React, { useState } from 'react';
import { api } from '../utils/api';
import { addHistoryEntry } from '../utils/storage';
import TopNav from './TopNav';

export default function WorkflowSize({ onBack, onNavigate }) {
  const [frontImage, setFrontImage] = useState(null);
  const [sideImage, setSideImage] = useState(null);
  const [heightValue, setHeightValue] = useState('');
  const [heightUnit, setHeightUnit] = useState('inches');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleImageUpload = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result);
    reader.readAsDataURL(file);
  };

  const handlePredict = async () => {
    if (!frontImage || !sideImage || !heightValue) {
      setError('Please provide front image, side image, and height.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const heightStr = heightValue + ' ' + heightUnit;
      const res = await api('POST', '/api/gemini-size-prediction', {
        frontImage,
        sideImage,
        heightStr
      });
      
      setResult(res.measurements);
      
      // Save history
      try {
        await addHistoryEntry({
          type: 'size_predicted',
          workflow: 'G',
          label: 'Size Prediction: ' + heightStr,
          frontImage,
          sideImage,
          result: res.measurements,
          height: heightStr,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('History save error:', e);
      }
    } catch (err) {
      setError(err.message || 'Prediction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <TopNav onBack={onBack} onNavigate={onNavigate} title="Size Predictor" />
      
      <div className="screen-body" style={{ display: 'flex', gap: 24, padding: 24 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Upload Photos</h3>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>Front Photo (Tucked in)</label>
                <div 
                  style={{ border: '2px dashed var(--gray-300)', padding: 20, textAlign: 'center', borderRadius: 8, cursor: 'pointer', background: '#fafafa', position: 'relative', overflow: 'hidden' }}
                  onClick={() => document.getElementById('front-upload').click()}
                >
                  {frontImage ? (
                    <img src={frontImage} style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} alt="Front" />
                  ) : (
                    <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>Click to upload Front Photo</div>
                  )}
                  <input type="file" id="front-upload" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, setFrontImage)} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>Side Photo (Tucked in)</label>
                <div 
                  style={{ border: '2px dashed var(--gray-300)', padding: 20, textAlign: 'center', borderRadius: 8, cursor: 'pointer', background: '#fafafa', position: 'relative', overflow: 'hidden' }}
                  onClick={() => document.getElementById('side-upload').click()}
                >
                  {sideImage ? (
                    <img src={sideImage} style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} alt="Side" />
                  ) : (
                    <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>Click to upload Side Photo</div>
                  )}
                  <input type="file" id="side-upload" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, setSideImage)} />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Height Details</h3>
            <div style={{ display: 'flex', gap: 12 }}>
              <input 
                type="number" 
                className="input" 
                placeholder="e.g. 5.5 or 165" 
                value={heightValue}
                onChange={e => setHeightValue(e.target.value)}
                style={{ flex: 1 }}
              />
              <select className="select" value={heightUnit} onChange={e => setHeightUnit(e.target.value)} style={{ width: 120 }}>
                <option value="inches">Inches</option>
                <option value="feet">Feet</option>
                <option value="cm">cm</option>
                <option value="meters">Meters</option>
              </select>
            </div>
          </div>
          
          {error && <div className="alert alert-error">{error}</div>}
          
          <button className="btn btn-primary" onClick={handlePredict} disabled={loading || !frontImage || !sideImage || !heightValue}>
            {loading ? 'Predicting Measurements...' : 'Predict Measurements (3 Credits)'}
          </button>
        </div>

        <div style={{ flex: 1 }}>
          <div className="card" style={{ height: '100%', minHeight: 400 }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Predicted Measurements (Inches)</h3>
            
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                <div className="spinner spinner-dark" />
              </div>
            ) : result ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <tbody>
                  {[
                    ['Chest / Bust', result.chest_bust],
                    ['Waist', result.waist],
                    ['Hips', result.hips],
                    ['Shoulders', result.shoulders],
                    ['Thighs', result.thighs],
                    ['High Point Shoulder to Bust', result.hps_to_bust],
                    ['High Point Shoulder to Waist', result.hps_to_waist],
                    ['High Point Shoulder to Hips', result.hps_to_hips],
                    ['High Point Shoulder to Thighs', result.hps_to_thighs]
                  ].map(([label, val]) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--gray-200)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 500 }}>{label}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600 }}>{val} in</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--gray-500)', fontSize: 13 }}>
                Fill details and click Predict to see results here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
