import React, { useState, useEffect, useRef } from 'react';

export default function WorkflowSize({ onBack, onNavigate }) {
  const [frontImage, setFrontImage] = useState(null);
  const [sideImage, setSideImage] = useState(null);
  const [heightValue, setHeightValue] = useState('168');
  const [heightUnit, setHeightUnit] = useState('cm');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [modelReady, setModelReady] = useState(false);
  const poseRef = useRef(null);

  useEffect(() => {
    const loadMediaPipe = async () => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js';
      script.async = true;
      script.onload = () => {
        const pose = new window.Pose({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });
        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: true,
          smoothSegmentation: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        poseRef.current = pose;
        setModelReady(true);
      };
      document.body.appendChild(script);
    };
    loadMediaPipe();
  }, []);

  const handleImageUpload = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result);
    reader.readAsDataURL(file);
  };

  const getMaskWidthAtY = (maskCanvas, y) => {
    const ctx = maskCanvas.getContext('2d');
    const width = maskCanvas.width;
    const imgData = ctx.getImageData(0, y, width, 1).data;
    let minX = width, maxX = 0;
    for (let x = 0; x < width; x++) {
      // mask is stored in red channel (or alpha)
      if (imgData[x * 4 + 3] > 128) {
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

        poseRef.current.onResults((results) => {
          if (!results.poseLandmarks || !results.segmentationMask) {
            resolve(null);
            return;
          }
          
          // Draw mask to a temp canvas to measure pixel widths
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = img.width;
          maskCanvas.height = img.height;
          const maskCtx = maskCanvas.getContext('2d');
          maskCtx.drawImage(results.segmentationMask, 0, 0, img.width, img.height);

          const lm = results.poseLandmarks;
          
          // Get pixel height from Nose (0) to Ankle (27/28)
          const topY = lm[0].y * img.height;
          const bottomY = Math.max(lm[27].y, lm[28].y) * img.height;
          const pixelHeight = bottomY - topY;

          // Define key Y positions
          const shoulderY = ((lm[11].y + lm[12].y) / 2) * img.height;
          const hipY = ((lm[23].y + lm[24].y) / 2) * img.height;
          const chestY = shoulderY + (hipY - shoulderY) * 0.2; // 20% down from shoulders
          const waistY = shoulderY + (hipY - shoulderY) * 0.6; // 60% down from shoulders
          
          const widths = {
            shoulder: getMaskWidthAtY(maskCanvas, Math.floor(shoulderY)),
            chest: getMaskWidthAtY(maskCanvas, Math.floor(chestY)),
            waist: getMaskWidthAtY(maskCanvas, Math.floor(waistY)),
            hip: getMaskWidthAtY(maskCanvas, Math.floor(hipY)),
          };

          resolve({ pixelHeight, widths });
        });
        await poseRef.current.send({image: img});
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

    // Calculate circumference using Ramanujan's ellipse approximation
    // C ~ pi * (3(a+b) - sqrt((3a+b)(a+3b))) where a=width/2, b=depth/2
    const calcCirc = (wPx, dPx) => {
      const a = (wPx * inPerPixel) / 2;
      const b = dPx ? (dPx * inPerPixel) / 2 : (wPx * inPerPixel * 0.6) / 2; // Guess depth if missing
      return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    };

    setResult({
      chest_bust: calcCirc(frontData.widths.chest, sideData?.widths.chest).toFixed(1),
      waist: calcCirc(frontData.widths.waist, sideData?.widths.waist).toFixed(1),
      hips: calcCirc(frontData.widths.hip, sideData?.widths.hip).toFixed(1),
      shoulders: (frontData.widths.shoulder * inPerPixel).toFixed(1) + " (width)",
      thighs: calcCirc(frontData.widths.hip * 0.5, sideData?.widths.hip * 0.5).toFixed(1),
      hps_to_waist: ((frontData.widths.waist * inPerPixel) * 1.2).toFixed(1), // Rough estimate
    });
    
    setLoading(false);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="screen-header">
        <div>
          <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
          <h1>📏 Size Predictor (Local CV)</h1>
          <p>Uses on-device computer vision to measure you instantly. No API credits used.</p>
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
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>Side Photo (Optional)</label>
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
            {loading ? 'Analyzing Body...' : !modelReady ? 'Loading CV Model...' : 'Calculate Measurements'}
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
