const fs = require('fs');
let code = fs.readFileSync('server/server.js', 'utf8');

const insertionPoint = "app.post('/api/ai/gemini-generate', requireAuth, requireActive, async (req, res) => {";

const newRoutes = \
const instantJobQueue = new Map();

app.get('/api/ai/instant-job-status/:groupId', requireAuth, (req, res) => {
  const job = instantJobQueue.get(req.params.groupId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.uid !== (req.userRole === 'admin' ? 'admin' : req.userId) && req.userRole !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  res.json({
    status: job.status,
    done: job.done,
    total: job.total,
    results: job.results
  });
});

app.post('/api/ai/queue-instant-jobs', requireAuth, requireActive, async (req, res) => {
  const { requests } = req.body;
  if (!Array.isArray(requests) || requests.length === 0) return res.status(400).json({ error: 'Requests array required' });
  
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const totalCredits = requests.length * 3;
  const uid = isAdmin ? 'admin' : req.userId;
  
  if (!isAdmin) {
    const check = checkAndDeductCredits(uid, totalCredits);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  instantJobQueue.set(groupId, {
    uid,
    status: 'running',
    done: 0,
    total: requests.length,
    results: []
  });

  res.json({ groupId, status: 'started', total: requests.length });

  // Async processing loop
  (async () => {
    const jobState = instantJobQueue.get(groupId);
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: googleKey });
    
    for (let i = 0; i < requests.length; i++) {
      const reqData = requests[i];
      const { model, images, prompt, aspectRatio, imageSize, historyMeta, key } = reqData;
      let finalB64 = '';
      let errorStr = '';

      try {
        const parts = [];
        for (const img of (images || [])) {
          const data = img.replace(/^data:image\\/\\w+;base64,/, '');
          const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          const buffer = Buffer.from(data, 'base64');
          const blob = new Blob([buffer], { type: mimeType });
          const uploaded = await ai.files.upload({ file: blob, config: { mimeType, displayName: 'shootai_instant' } });
          parts.push({ fileData: { fileUri: uploaded.uri, mimeType } });
        }
        parts.push({ text: prompt });

        let modelId = model || 'gemini-3.1-flash-image';
        if (modelId === 'gemini-2.0-flash-preview-image-generation' || modelId === 'gemini-3-pro-image') {
          modelId = 'gemini-3.1-flash-image';
        }
        const config = { 
          responseModalities: ['IMAGE'],
          candidateCount: 1,
          imageConfig: { aspectRatio: aspectRatio || '3:4', imageSize: imageSize || '1K' }
        };
        
        let response;
        let retries = 3;
        while (retries > 0) {
          try {
            response = await ai.models.generateContent({ model: modelId, contents: parts, config });
            break;
          } catch (err) {
            if (err.status === 503 || (err.message && err.message.includes('503'))) {
              retries--;
              if (retries === 0) throw err;
              await new Promise(r => setTimeout(r, 2000));
            } else {
              throw err;
            }
          }
        }

        const candidate = response.candidates?.[0];
        if (!candidate) {
          throw new Error('No response from Gemini');
        }

        let foundImg = false;
        for (const part of (candidate.content?.parts || [])) {
          if (part.inlineData?.data || part.inlineData?.data?.length) {
            let b64 = part.inlineData.data;
            if (typeof b64 !== 'string') b64 = Buffer.from(b64).toString('base64');
            const mime = part.inlineData.mimeType || 'image/png';
            finalB64 = b64.startsWith('data:') ? b64 : \data:\;base64,\\;
            foundImg = true;
            break;
          }
        }
        if (!foundImg) throw new Error('Gemini returned no image');
        
        if (!isAdmin) {
          recordImages(uid, 1);
        }
        appendAuditLog(uid, { event: 'realtime_generated', engine: 'gemini', credits: isAdmin ? 0 : 3 });

        if (historyMeta) {
          const history = readUserStore(uid, 'history') || [];
          history.unshift({ 
            ...historyMeta, 
            id: \gen_\\, 
            createdAt: new Date().toISOString(), 
            imageData: finalB64,
            source: 'instant_queue'
          });
          writeUserStore(uid, 'history', history.slice(0, 40));
        }

      } catch (e) {
        errorStr = e.response?.data?.error?.message || e.message;
        if (!isAdmin) refundCredits(uid, 3, 'generation error');
      }

      jobState.results.push({
        key,
        status: finalB64 ? 'done' : 'error',
        base64: finalB64,
        error: errorStr
      });
      jobState.done += 1;
    }
    
    jobState.status = 'completed';
    setTimeout(() => {
      instantJobQueue.delete(groupId);
    }, 60 * 60 * 1000);
  })();
});

app.post('/api/ai/gemini-generate', requireAuth, requireActive, async (req, res) => {
\;

code = code.replace(insertionPoint, newRoutes);
fs.writeFileSync('server/server.js', code);
console.log('done patching server');
