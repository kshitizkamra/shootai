import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# We need to insert our new route before the catch-all or at the end of the api routes.
# Let's find the end of gemini-batch-cancel
anchor = "app.post('/api/ai/gemini-batch-cancel', requireAuth, async (req, res) => {"

shopify_route = """

// ============================================================================
// SHOPIFY VTO INTEGRATION
// ============================================================================

app.post('/api/shopify/vto', async (req, res) => {
  // 1. Basic CORS check
  const origin = req.headers.origin || '';
  // You can strictly enforce origin here if needed:
  // if (!origin.includes('myshopify.com')) return res.status(403).json({ error: 'Unauthorized' });

  const { customerImageBase64, productImageUrls } = req.body;
  if (!customerImageBase64) return res.status(400).json({ error: 'Missing customer image' });
  if (!productImageUrls || !productImageUrls.length) return res.status(400).json({ error: 'Missing product images' });

  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(500).json({ error: 'AI service not configured.' });

  try {
    console.log([Shopify VTO] Request received with  product images.);
    
    // 2. Fetch product images from URLs and convert to base64
    const productB64s = [];
    for (const url of productImageUrls) {
      if (!url) continue;
      try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        // Resize to avoid massive payloads
        const resized = await sharp(response.data).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        productB64s.push('data:image/webp;base64,' + resized.toString('base64'));
      } catch (err) {
        console.error([Shopify VTO] Failed to fetch product image :, err.message);
      }
    }

    if (!productB64s.length) return res.status(400).json({ error: 'Could not fetch any product images.' });

    // 3. Assemble images array (Index 0 = Customer)
    const images = [customerImageBase64, ...productB64s];
    
    // 4. Construct the strict prompt
    let productLines = '';
    for (let i = 0; i < productB64s.length; i++) {
      productLines += Product reference image : use this for garment details.\\n;
    }

    const prompt = I am uploading  reference images:
1. MODEL reference - this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, pose, and background environment. Reference image 1 is the SOLE source for the model's identity and setting.


Generate a photorealistic fashion photograph.

CHARACTER: ONLY the woman from reference image 1.
GARMENT: Reproduce the exact garment from the product reference image(s). EVERY design detail (seams, buttons, zippers, fabric texture), color (hue, saturation, brightness), print pattern (motifs, scale, density), and construction MUST be accurate. The garment must fit the model naturally, following the contours of her body. DO NOT simplify, reinterpret, or alter any design element.
POSE & BACKGROUND: Copy the EXACT pose, camera angle, and background from reference image 1. The setting must match pixel-perfectly. The model must cast a physically accurate shadow matching the lighting direction of the background.
Premium D2C fashion brand product photography quality.
No text, no overlays, no watermarks.;

    const ai = new GoogleGenAI({ apiKey: googleKey });
    const parts = [];
    for (const img of images) {
      const b64 = img.includes(',') ? img.split(',')[1] : img;
      parts.push({
        inlineData: {
          data: b64,
          mimeType: img.startsWith('data:') ? img.split(';')[0].split(':')[1] : 'image/jpeg',
        }
      });
    }
    parts.push({ text: prompt });

    // 5. Generate instantly
    console.log('[Shopify VTO] Calling Gemini...');
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: parts,
      config: {
        outputMimeType: "image/jpeg",
        personGeneration: "ALLOW_ALL",
        aspectRatio: "3:4", // Force standard portrait
        imageSize: "1024x1024", // Standard 1K for speed
      }
    });

    const b64Output = response.candidates[0].content.parts[0].inlineData.data;
    console.log('[Shopify VTO] Success!');
    
    res.json({ success: true, image: 'data:image/jpeg;base64,' + b64Output });
  } catch (err) {
    console.error('[Shopify VTO] Error:', err.message);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

"""

# Insert shopify_route just before anchor
text = text.replace(anchor, shopify_route + anchor)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Shopify route added to server/server.js")
