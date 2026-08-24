import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

anchor = "app.post('/api/gemini-batch-cancel', requireAuth, requireActive, (req, res) => {"

api_code = """app.post('/api/gemini-size-prediction', requireAuth, requireActive, async (req, res) => {
  const { frontImage, sideImage, heightStr } = req.body;
  if (!frontImage || !sideImage || !heightStr) {
    return res.status(400).json({ error: 'Missing images or height' });
  }
  
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(500).json({ error: 'AI service not configured.' });

  try {
    const ai = new GoogleGenAI({ apiKey: googleKey });
    
    // Convert to inline data
    const frontB64 = frontImage.includes(',') ? frontImage.split(',')[1] : frontImage;
    const sideB64 = sideImage.includes(',') ? sideImage.split(',')[1] : sideImage;
    
    const parts = [
      { inlineData: { data: frontB64, mimeType: frontImage.startsWith('data:') ? frontImage.split(';')[0].split(':')[1] : 'image/jpeg' } },
      { inlineData: { data: sideB64, mimeType: sideImage.startsWith('data:') ? sideImage.split(';')[0].split(':')[1] : 'image/jpeg' } }
    ];
    
    const prompt = You are an expert master tailor and anthropometrist. You are given a front and side photo of a person.
Their EXACT height is .

Using this height as a precise physical scale reference, analyze their body proportions and calculate the following measurements exactly in INCHES.
Respond ONLY with a JSON object containing the exact numerical values (as strings or numbers) for the following keys:
- chest_bust
- waist
- hips
- shoulders
- thighs
- hps_to_bust
- hps_to_waist
- hps_to_hips
- hps_to_thighs

Do not include markdown blocks or any other text. Output strict JSON only.;

    parts.push({ text: prompt });
    
    const reqBody = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    };
    
    const geminiRes = await ai.generate('gemini-1.5-flash', reqBody);
    
    let measurements;
    try {
      measurements = JSON.parse(geminiRes);
    } catch (e) {
      return res.status(500).json({ error: 'AI returned invalid JSON format' });
    }
    
    const cost = 3;
    const isAdmin = req.userId === 'admin';
    if (!isAdmin) {
      const user = readUsers().find(u => u.id === req.userId);
      if (!user || user.credits < cost) return res.status(403).json({ error: 'Insufficient credits' });
      addTransaction(req.userId, 'credit_used', -cost, 'Size Prediction');
      const latest = readUsers().find(u => u.id === req.userId);
      if (latest && latest.credits >= 0) {
        latest.credits -= cost;
        writeUserStore();
      }
    }
    
    appendAuditLog(req.userId, { event: 'size_predicted', credits: isAdmin ? 0 : cost });
    
    res.json({ success: true, measurements });
  } catch (err) {
    console.error('Size prediction error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

"""

text = text.replace(anchor, api_code + anchor)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Added API route")
