import React, { useState, useEffect, useRef } from 'react';

export default function WorkflowSize({ onBack, onNavigate }) {
  const [frontImage, setFrontImage] = useState(null);
  const [sideImage, setSideImage] = useState(null);
  const [heightValue, setHeightValue] = useState('168');
  const [heightUnit, setHeightUnit] = useState('cm');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [modelReady, setModelReady] = useState(false);
  const netRef = useRef(null);

  useEffect(() => {
    const loadBodyPix = async () => {
      try {
        // Load tfjs
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.11.0/dist/tf.min.js';
          script.onload = resolve;
          document.body.appendChild(script);
        });
        // Load body-pix
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js';
          script.onload = resolve;
          document.body.appendChild(script);
        });

        const net = await window.bodyPix.load({
          architecture: 'ResNet50',
          outputStride: 16,
          quantBytes: 2
        });
        netRef.current = net;
        setModelReady(true);
      } catch (err) {
        console.error("Failed to load BodyPix:", err);
      }
    };
    loadBodyPix();
  }, []);

  const handleImageUpload = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result);
    reader.readAsDataURL(file);
  };

  const getTorsoWidthAtY = (data, width, targetY) => {
    let minX = width, maxX = 0;
    const yOffset = targetY * width;
    for (let x = 0; x < width; x++) {
      const partId = data[yOffset + x];
      // 12=torsoFront, 13=torsoBack
      if (partId === 12 || partId === 13) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return maxX > minX ? (maxX - minX) : 0;
  };

  const getFullWidthAtY = (data, width, targetY) => {
    let minX = width, maxX = 0;
    const yOffset = targetY * width;
    for (let x = 0; x < width; x++) {
      const partId = data[yOffset + x];
      // Any person part (-1 is background)
      if (partId !== -1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return maxX > minX ? (maxX - minX) : 0;
  };

  const processImage = async (imgSrc) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imgSrc;
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const partSegmentation = await netRef.current.segmentPersonParts(canvas, {
          internalResolution: 'full',
          segmentationThreshold: 0.7
        });

        const data = partSegmentation.data;
        const w = img.width;
        const h = img.height;

        // Find person bounding box for pixel height
        let minY = h, maxY = 0;
        let torsoMinY = h, torsoMaxY = 0;
        
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const partId = data[y * w + x];
            if (partId !== -1) {
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
            if (partId === 12 || partId === 13) {
              if (y < torsoMinY) torsoMinY = y;
              if (y > torsoMaxY) torsoMaxY = y;
            }
          }
        }

        const pixelHeight = maxY - minY;
        const torsoHeight = torsoMaxY - torsoMinY;

        // Define measurement lines on the torso
        const chestY = Math.floor(torsoMinY + torsoHeight * 0.2);
        const waistY = Math.floor(torsoMinY + torsoHeight * 0.5);
        const hipY = Math.floor(torsoMinY + torsoHeight * 0.9);
        const shoulderY = Math.floor(torsoMinY + torsoHeight * 0.05);

        const widths = {
          shoulder: getTorsoWidthAtY(data, w, shoulderY),
          chest: getTorsoWidthAtY(data, w, chestY),
          waist: getTorsoWidthAtY(data, w, waistY),
          hip: getTorsoWidthAtY(data, w, hipY),
          
          // Fallback to full width for side profile depths
          full_shoulder: getFullWidthAtY(data, w, shoulderY),
          full_chest: getFullWidthAtY(data, w, chestY),
          full_waist: getFullWidthAtY(data, w, waistY),
          full_hip: getFullWidthAtY(data, w, hipY),
        };

        resolve({ pixelHeight, widths });
      };
    });
  };

  const handlePredict = async () => {
    setLoading(true);
    
    // Parse height in cm
    let cm = parseFloat(heightValue);
    if (heightUnit === 'inches') cm = cm * 2.54;
    if (heightUnit === 'feet') cm = cm * 30.48;
    
    const frontData = await processImage(frontImage);
    const sideData = sideImage ? await processImage(sideImage) : null;
    
    if (!frontData) {
      alert("Could not detect a person in the front image.");
      setLoading(false);
      return;
    }

    // Scale
    const cmPerPixel = cm / frontData.pixelHeight;
    const inPerPixel = cmPerPixel / 2.54;

    // Circumference using Ramanujan ellipse formula
    const calcCirc = (wPx, sideObj, key) => {
      const a = (wPx * inPerPixel) / 2;
      // If side image exists, use its FULL width (depth) at that point. Otherwise guess depth = width * 0.6
      const dPx = sideObj ? sideObj.widths['full_' + key] : (wPx * 0.6);
      const b = (dPx * inPerPixel) / 2;
      return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    };

    setResult({
      chest_bust: calcCirc(frontData.widths.chest, sideData, 'chest').toFixed(1),
      waist: calcCirc(frontData.widths.waist, sideData, 'waist').toFixed(1),
      hips: calcCirc(frontData.widths.hip, sideData, 'hip').toFixed(1),
      shoulders_width: (frontData.widths.shoulder * inPerPixel).toFixed(1) + " in",
      hps_to_waist: (frontData.widths.waist * inPerPixel * 1.5).toFixed(1) + " in", // basic vertical estimate
    });
    
    setLoading(false);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="screen-header">
        <div>
          <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
          <h1>📏 Size Predictor (BodyPix AI)</h1>
          <p>Uses on-device TensorFlow BodyPix to isolate your torso from your arms for exact measurements.</p>
        </div>
      </div>
      
      <div className="screen-body" style={{ display: 'flex', gap: 24, padding: 24 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Upload Photos</h3>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>Front Photo</label>
                <div 
                  style={{ border: '2px dashed var(--gray-300)', padding: 20, textAlign: 'center', borderRadius: 8, cursor: 'pointer', background: '#fafafa', position: 'relative', overflow: 'hidden' }}
                  onClick={() => document.getElementById('front-upload').click()}
                >
                  {frontImage ? <img src={frontImage} style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} alt="Front" /> : <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>Click to upload</div>}
                  <input type="file" id="front-upload" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, setFrontImage)} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>Side Photo (Crucial for Depth)</label>
                <div 
                  style={{ border: '2px dashed var(--gray-300)', padding: 20, textAlign: 'center', borderRadius: 8, cursor: 'pointer', background: '#fafafa', position: 'relative', overflow: 'hidden' }}
                  onClick={() => document.getElementById('side-upload').click()}
                >
                  {sideImage ? <img src={sideImage} style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} alt="Side" /> : <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>Click to upload</div>}
                  <input type="file" id="side-upload" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, setSideImage)} />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Height Details</h3>
            <div style={{ display: 'flex', gap: 12 }}>
              <input type="number" className="input" value={heightValue} onChange={e => setHeightValue(e.target.value)} style={{ flex: 1 }} />
              <select className="select" value={heightUnit} onChange={e => setHeightUnit(e.target.value)} style={{ width: 120 }}>
                <option value="cm">cm</option>
                <option value="inches">Inches</option>
                <option value="feet">Feet</option>
              </select>
            </div>
          </div>
          
          <button className="btn btn-primary" onClick={handlePredict} disabled={loading || !frontImage || !heightValue || !modelReady}>
            {loading ? 'Analyzing Torso Pixels...' : !modelReady ? 'Loading BodyPix AI...' : 'Calculate Measurements'}
          </button>
        </div>

        <div style={{ flex: 1 }}>
          <div className="card" style={{ height: '100%', minHeight: 400 }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Predicted Measurements (Inches)</h3>
            
            {result ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <tbody>
                  {Object.entries(result).map(([label, val]) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--gray-200)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 500, textTransform: 'capitalize' }}>{label.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600 }}>{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--gray-500)', fontSize: 13 }}>
                Result will appear here. Runs 100% locally.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
