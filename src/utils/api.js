import { getSettings } from './storage';
import { getGeminiAspectRatio, getGeminiImageSize } from './constants';

// Lazy proxy — reads window.electronAPI at call time, not at module load time
// (ES module imports are evaluated before installWebShim() runs in index.js)
const api = new Proxy({}, { get: (_, k) => (...args) => window.electronAPI[k](...args) });

// ── Background presets ────────────────────────────────────────────────────

export const BACKGROUND_PRESETS = [
  {
    id: 'preset_white_studio',
    name: 'White Studio',
    preset: true,
    description: 'A clean, bright white photography studio background with soft, even lighting. Pure white backdrop, minimal shadows. Professional product photography.',
  },
  {
    id: 'preset_office_corridor',
    name: 'Office Corridor',
    preset: true,
    description: 'A modern office corridor with Mumbai skyline view through floor-to-ceiling windows, warm wood floor, contemporary interior design. Professional lifestyle setting.',
  },
  {
    id: 'preset_cafe_terrace',
    name: 'Café Terrace',
    preset: true,
    description: 'An elegant café terrace with sandstone walls, marble table, warm ambient lighting, Mediterranean-inspired architecture. Sophisticated lifestyle background.',
  },
  {
    id: 'preset_haveli_courtyard',
    name: 'Haveli Courtyard',
    preset: true,
    description: 'A beautiful traditional Indian haveli courtyard blending Goa and Pondicherry heritage architecture. Intricate stonework, colorful tiles, lush tropical plants, golden afternoon light.',
  },
  {
    id: 'preset_bedroom',
    name: 'Bedroom',
    preset: true,
    description: 'A warm, minimal Indian morning bedroom with soft natural light streaming through sheer curtains. Neutral tones, clean linen, plants, cozy minimal aesthetic.',
  },
];

// ── Get API key ────────────────────────────────────────────────────────────

async function getApiKey() {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error('No API key set. Please configure your OpenAI API key in Settings.');
  return settings.apiKey;
}

// ── Gemini: shared multi-image generate ───────────────────────────────────
// Called internally by workflow functions when googleApiKey is set.
// Throws on failure — caller catches and can offer OpenAI fallback.

async function callGemini({ images, prompt, quality, resolution }) {
  const settings = await getSettings();
  const model = settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  try {
    return await api.geminiGenerate({
      model,
      images,
      prompt,
      aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
      imageSize: getGeminiImageSize(quality || 'high', model),
    });
  } catch (err) {
    // Re-throw with a friendlier message for quota/billing errors
    const msg = err.message || '';
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
      throw new Error(`[Gemini quota] ${model} exceeded its quota or requires billing. Go to Settings → change Gemini model to "Flash (free tier)" or enable billing at aistudio.google.com.`);
    }
    throw err;
  }
}

// ── Test connection ────────────────────────────────────────────────────────

export async function testConnection(apiKey) {
  return await api.testConnection(apiKey);
}

// ── Generate background image from preset/text ─────────────────────────────

export async function generateBackgroundImage(description) {
  const apiKey = await getApiKey();
  const prompt = `${description} High quality, photorealistic, suitable as a fashion photography background. No people, no text, no watermarks.`;
  return await api.generateImage({ apiKey, prompt, size: '1024x1536', quality: 'high' });
}

// ── Generate model image from description ─────────────────────────────────

export async function generateModelImage(description) {
  const apiKey = await getApiKey();
  const prompt = `A professional fashion model photograph: ${description}. Indian woman, photorealistic, full body portrait, neutral studio setting, no garments shown, just the model's pose and appearance. No text, no watermarks.`;
  return await api.generateImage({ apiKey, prompt, size: '1024x1536', quality: 'high' });
}

// ── Workflow A: Change Background ──────────────────────────────────────────

export async function changeBackground({ productImageBase64, backgroundImageBase64, backgroundDescription, quality, apiSize, resolution, skipGemini }) {
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';

  // Try Gemini first if key is configured and not explicitly skipped
  if (!skipGemini) {
    const images = backgroundImageBase64
      ? [productImageBase64, backgroundImageBase64]
      : [productImageBase64];
    const bgDesc = backgroundDescription || 'a clean white photography studio background';
    const prompt = backgroundImageBase64
      ? `I am uploading 2 images:\n1. ORIGINAL photo — preserve the person, pose, outfit, props, and lighting EXACTLY\n2. Background reference — replace ONLY the background/wall/floor with this environment\n\nCRITICAL: Do NOT change the person's face, pose, clothing, accessories, or lighting. ONLY swap the background.\n\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop in physical contact with or held by the model must be preserved exactly. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model. ONLY the background and floor/ground surface behind and beneath the model may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`
      : `Replace ONLY the background of this photo with: ${bgDesc}\n\nCRITICAL: Do NOT change the person's face, expression, pose, clothing, accessories, or lighting direction. ONLY change the background/environment behind the person.\n\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop in physical contact with or held by the model must be preserved exactly. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model. ONLY the background and floor/ground surface behind and beneath the model may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`;
    return await callGemini({ images, prompt, quality: q, resolution });
  }

  const apiKey = await getApiKey();

  const preservationRules = `CRITICAL PRESERVATION RULES - do NOT change any of these:
- The person's face, expression, hair, skin tone
- The person's exact pose and body position
- The clothing/garment — every detail, color, print, texture
- All accessories (glasses, jewelry, bags, etc.)
- All props in the scene (chairs, tables, etc.)
- The lighting direction and shadow style on the person

ONLY change: the background/environment behind the person and the floor/ground surface color to match.`;

  if (backgroundImageBase64) {
    return await api.multiImageGenerate({
      apiKey,
      images: [productImageBase64, backgroundImageBase64],
      prompt: `I am uploading 2 images:
1. ORIGINAL photo — preserve the person, pose, outfit, props, and lighting EXACTLY
2. Background reference — replace ONLY the background/wall/floor with this environment

${preservationRules}

PRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop in physical contact with or held by the model must be preserved exactly. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model. ONLY the background and floor/ground surface behind and beneath the model may change.
NATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.

No text, no watermarks.`,
      quality: q,
      size: sz,
    });
  }

  const bgDesc = backgroundDescription || 'a clean white photography studio background';
  return await api.editImage({
    apiKey,
    imageBase64: productImageBase64,
    prompt: `Replace ONLY the background of this photo with: ${bgDesc}

${preservationRules}

PRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop in physical contact with or held by the model must be preserved exactly. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model. ONLY the background and floor/ground surface behind and beneath the model may change.
NATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.

No text, no watermarks.`,
    size: sz,
    quality: q,
  });
}

// ── Workflow B: Change Model ───────────────────────────────────────────────

export async function changeModel({ productImageBase64, modelImageBase64, quality, apiSize, resolution, skipGemini }) {
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';

  if (!skipGemini) {
    return await callGemini({
      images: [modelImageBase64, productImageBase64],
      prompt: `I am uploading 2 reference images:\n1. Model reference - use this exact woman's face, body structure, skin tone and hair\n2. Product image - reproduce this exact garment on the model in every detail\n\nGenerate a photorealistic studio fashion photograph.\nCHARACTER: exact woman from reference image 1.\nGARMENT: reproduce exact garment from reference image 2. Every detail accurate.\nSETTING: clean white studio background.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nSoft diffused lighting. Premium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks.`,
      quality: q, resolution,
    });
  }

  const apiKey = await getApiKey();
  return await api.multiImageGenerate({
    apiKey,
    images: [modelImageBase64, productImageBase64],
    prompt: `I am uploading 2 reference images:\n1. Model reference - use this exact woman's face, body structure, skin tone and hair\n2. Product image - reproduce this exact garment on the model in every detail\n\nGenerate a photorealistic studio fashion photograph in 2:3 portrait format.\nCHARACTER: exact woman from reference image 1.\nGARMENT: reproduce exact garment from reference image 2. Every detail accurate.\nSETTING: clean white studio background.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nSoft diffused lighting. Premium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks.`,
    quality: q,
    size: sz,
  });
}

// ── Workflow C: Full PDP Shoot ─────────────────────────────────────────────

const SHOT_PROMPTS = {
  'Front': `MODEL IDENTITY: Use ONLY the exact woman from reference image 1 — her face, skin tone, hair, and body. Do NOT use the person from any product reference image. Action: standing naturally, arms relaxed, looking slightly off camera. FULL BODY — entire figure from top of head to feet must be fully visible. Do NOT crop below the knees. Feet must be visible at the bottom of the frame. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it.`,
  'Styled': `MODEL IDENTITY — NON-NEGOTIABLE: The only person in this image must be the exact woman from reference image 1. Her face, skin tone, hair, and body are the only acceptable option. The person shown wearing the garment in the product reference images is a placeholder — their face must NOT appear. Action: editorial lifestyle pose — creative, natural, and expressive. The model should look candid and editorial, not stiff. Use the selected background environment naturally. Mood: aspirational fashion campaign. FRAMING: The model should occupy at least 65% of the frame height — medium to medium-wide shot. Do NOT pull so wide that the model becomes a small figure in the frame. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others.`,
  'Side': `MODEL IDENTITY: Use ONLY the exact woman from reference image 1 — her face, skin tone, hair, and body. Do NOT use the person from any product reference image. CRITICAL: The face, skin tone, and body in the output must match reference image 1 exactly — any other person's likeness is strictly forbidden. Action: model facing completely to the right, FULL BODY — entire figure from head to feet visible, shows garment silhouette. Do NOT crop below the knees. Feet must be visible. BACKGROUND: keep the exact same background as specified in SETTING — do not alter the background color, tone, or environment in any way. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it. SHADOW: The model must cast a natural shadow consistent with the ambient light — this anchors her physically in the space.`,
  'Back': `MODEL IDENTITY: Use ONLY the exact woman from reference image 1 — her face, skin tone, hair, and body. Do NOT use the person from any product reference image. Action: model facing away from camera, hair swept to one side, shows back of garment. FULL BODY — entire figure from head to feet visible. Do NOT crop below the knees. Feet must be visible. CRITICAL: The garment color on the back must exactly match the color in all reference images — do not shift, darken, or alter the hue in any way. BACKGROUND: keep the exact same background as specified in SETTING — do not alter the background color, tone, or environment in any way. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it. SHADOW: The model must cast a natural shadow consistent with the ambient light — this anchors her physically in the space.`,
  'Detail Close-Up': `Action: ZOOM INTO THE ACTUAL GARMENT on the model. The model wearing the garment MUST be the exact same woman from MODEL reference image 1 — same face, same skin tone, same body. Do NOT use the person from any product reference image. Do NOT reimagine, reconstruct, add, or exaggerate any garment detail. Do not over-emphasize seams or stitching beyond what is visible in the reference. Do NOT add smocking, gathering, shirring, elastic, ruffles, or any embellishment at the waist or any other area that is not clearly visible in the reference images — if the garment has a plain seam at the waist, keep it as a plain seam. CRITICAL: The garment color must exactly match the color in all reference images — do not shift, darken, or alter the hue in any way. FOOTWEAR NOTE: Do NOT alter the framing of this shot to show footwear — only include footwear if feet fall naturally within the detail area being shown. Do not zoom out or reframe to accommodate shoes. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set.`,
};

export async function generatePDPShot({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, apiSize, resolution, skipGemini }) {
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';
  let shotPrompt = SHOT_PROMPTS[shotType] || SHOT_PROMPTS['Front'];
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }

  const effectivePose = (shotType === 'Styled' && !shotInstruction) ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');

  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — place the model in this exact setting`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — extract ONLY the body stance, posture, and arm/leg positions from this image. The person and clothing in this image are irrelevant — use only the body pose.`
    : '';

  const prompt = `I am uploading ${images.length} reference images:
1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}. Do NOT use the face or body of anyone in the product images.
${productLines}
${bgLine}${poseLine ? '\n' + poseLine : ''}

Generate a photorealistic fashion photograph in 2:3 portrait format.

CHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}. Replace any other person entirely.
GARMENT: Reproduce the exact garment from the product reference image(s). Every design detail, color, print pattern, and construction must be accurate. CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue in any way. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — do NOT alter any structural design element between shots. Product: ${productName || 'fashion item'}.
FOOTWEAR: Do NOT copy or reproduce footwear from any reference image — ignore the shoes on the model in reference image 1 and ignore any footwear visible in the product reference images. Default to simple nude pointed-toe heels unless a different footwear is specified in the global instruction. Apply the same footwear consistently across every shot in this set.
SETTING: ${backgroundImageBase64 ? `reproduce the exact background from reference image ${bgIdx} — same environment, same colors, same tone, same lighting. This background must be identical across every shot. Do NOT alter, vary, or reinterpret it in any way. Ignore any background visible in the product reference images — only use the designated background reference.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. This exact white studio background must be identical across every shot. Do NOT use or be influenced by any background, floor color, or environment visible in the product reference images — those backgrounds must be completely ignored.'}.${effectivePose ? `\nPOSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot (angle and framing requirements above take priority). Do NOT default to a plain standing pose when a pose reference is provided.` : ''}

${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (apply to all shots): ${globalInstruction}` : ''}
Soft diffused studio lighting. Premium D2C fashion brand photography quality.
2:3 portrait format. No text, no overlays, no watermarks.`;

  // Try Gemini first
  if (!skipGemini) {
    return await callGemini({ images, prompt, quality: q, resolution });
  }

  // OpenAI fallback
  const apiKey = await getApiKey();
  return await api.multiImageGenerate({ apiKey, images, prompt, quality: q, size: sz });
}

// ── Workflow D: Virtual Try-On ─────────────────────────────────────────────

export async function virtualTryOn({ garmentImageBase64, personImageBase64, quality, apiSize, resolution, skipGemini }) {
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';

  const prompt = `I am uploading 2 reference images:
1. Person/model image - use this exact person, their face, body, skin tone and hair
2. Garment image - dress this person in exactly this garment, every detail preserved

Generate a photorealistic photograph of the person wearing the garment naturally.
The garment should fit naturally on the person's body.
Keep the person's face, hair, and non-garment features exactly as in reference image 1.
Natural indoor or outdoor setting. Soft flattering lighting.
No text, no overlays, no watermarks.`;

  if (!skipGemini) {
    return await callGemini({ images: [personImageBase64, garmentImageBase64], prompt, quality: q, resolution });
  }

  const apiKey = await getApiKey();
  return await api.multiImageGenerate({
    apiKey,
    images: [personImageBase64, garmentImageBase64],
    prompt,
    quality: q,
    size: sz,
  });
}

// ── Batch item preparers ─────────────────────────────────────────────────
// These mirror the generate functions but return a batch queue item
// instead of calling the API.
// imageSize defaults to '2K' for batch — same token cost as '1K' but higher quality.

export async function prepareBatchChangeBackground({ productImageBase64, backgroundImageBase64, backgroundDescription, quality, resolution, label }) {
  const settings = await getSettings();
  const model = settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const images = backgroundImageBase64
    ? [productImageBase64, backgroundImageBase64]
    : [productImageBase64];
  const bgDesc = backgroundDescription || 'a clean white photography studio background';
  const prompt = backgroundImageBase64
    ? `I am uploading 2 images:\n1. ORIGINAL photo — preserve the person, pose, outfit, props, and lighting EXACTLY\n2. Background reference — replace ONLY the background/wall/floor with this environment\n\nCRITICAL: Do NOT change the person's face, pose, clothing, accessories, or lighting. ONLY swap the background.\n\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop in physical contact with or held by the model must be preserved exactly. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model. ONLY the background and floor/ground surface behind and beneath the model may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`
    : `Replace ONLY the background of this photo with: ${bgDesc}\n\nCRITICAL: Do NOT change the person's face, expression, pose, clothing, accessories, or lighting direction. ONLY change the background/environment behind the person.\n\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop in physical contact with or held by the model must be preserved exactly. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model. ONLY the background and floor/ground surface behind and beneath the model may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`;
  return {
    workflow: 'A',
    label: label || 'Background Change',
    images,
    prompt,
    aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
    resolution: resolution || '1080x1440',
    imageSize: getGeminiImageSize(quality || 'medium', model),
  };
}

export async function prepareBatchChangeModel({ modelImageBase64, productImageBase64, quality, resolution, label }) {
  const settings = await getSettings();
  const model = settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const images = [modelImageBase64, productImageBase64];
  const prompt = `I am uploading 2 reference images:\n1. Model reference - use this exact woman's face, body structure, skin tone and hair\n2. Product image - reproduce this exact garment on the model in every detail\n\nGenerate a photorealistic studio fashion photograph.\nCHARACTER: exact woman from reference image 1.\nGARMENT: reproduce exact garment from reference image 2. Every detail accurate.\nSETTING: clean white studio background.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nSoft diffused lighting. Premium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks.`;
  return {
    workflow: 'B',
    label: label || 'Change Model',
    images,
    prompt,
    aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
    resolution: resolution || '1080x1440',
    imageSize: getGeminiImageSize(quality || 'medium', model),
  };
}

export async function prepareBatchPDPShot({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, resolution, label, model: modelOverride }) {
  const settings = await getSettings();
  const model = modelOverride || settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const effectivePose = (shotType === 'Styled' && !shotInstruction) ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  const SHOT_PROMPTS_BATCH = {
    'Front': `MODEL IDENTITY: Use ONLY the exact woman from reference image 1 — her face, skin tone, hair, and body. Do NOT use the person from any product reference image. Action: standing naturally, arms relaxed, looking slightly off camera. FULL BODY — entire figure from top of head to feet must be fully visible. Do NOT crop below the knees. Feet must be visible at the bottom of the frame. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it.`,
    'Styled': `MODEL IDENTITY — NON-NEGOTIABLE: The only person in this image must be the exact woman from reference image 1. Her face, skin tone, hair, and body are the only acceptable option. The person shown wearing the garment in the product reference images is a placeholder — their face must NOT appear. Action: editorial lifestyle pose — creative, natural, and expressive. The model should look candid and editorial, not stiff. Use the selected background environment naturally. Mood: aspirational fashion campaign. FRAMING: The model should occupy at least 65% of the frame height — medium to medium-wide shot. Do NOT pull so wide that the model becomes a small figure in the frame. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others.`,
    'Side': `MODEL IDENTITY: Use ONLY the exact woman from reference image 1 — her face, skin tone, hair, and body. Do NOT use the person from any product reference image. CRITICAL: The face, skin tone, and body in the output must match reference image 1 exactly — any other person's likeness is strictly forbidden. Action: model facing completely to the right, FULL BODY — entire figure from head to feet visible, shows garment silhouette. Do NOT crop below the knees. Feet must be visible. BACKGROUND: keep the exact same background as specified in SETTING — do not alter the background color, tone, or environment in any way. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it. SHADOW: The model must cast a natural shadow consistent with the ambient light — this anchors her physically in the space.`,
    'Back': `MODEL IDENTITY: Use ONLY the exact woman from reference image 1 — her face, skin tone, hair, and body. Do NOT use the person from any product reference image. Action: model facing away from camera, hair swept to one side, shows back of garment. FULL BODY — entire figure from head to feet visible. Do NOT crop below the knees. Feet must be visible. CRITICAL: The garment color on the back must exactly match the color in all reference images — do not shift, darken, or alter the hue in any way. BACKGROUND: keep the exact same background as specified in SETTING — do not alter the background color, tone, or environment in any way. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it. SHADOW: The model must cast a natural shadow consistent with the ambient light — this anchors her physically in the space.`,
    'Detail Close-Up': `Action: ZOOM INTO THE ACTUAL GARMENT on the model — crop tightly to the specified area or the most detail-rich part of the outfit. The model wearing the garment MUST be the exact same woman from MODEL reference image 1 — same face, same skin tone, same body. Do NOT use the person from any product reference image. Do NOT reimagine, reconstruct, add, or exaggerate any garment detail. Do not over-emphasize seams or stitching beyond what is visible in the reference. Do NOT add smocking, gathering, shirring, elastic, ruffles, or any embellishment at the waist or any other area that is not clearly visible in the reference images — if the garment has a plain seam at the waist, keep it as a plain seam. CRITICAL: The garment color must exactly match the color in all reference images — do not shift, darken, or alter the hue in any way. FOOTWEAR NOTE: Do NOT alter the framing of this shot to show footwear — only include footwear if feet fall naturally within the detail area being shown. Do not zoom out or reframe to accommodate shoes. LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set.`,
  };
  let shotPrompt = SHOT_PROMPTS_BATCH[shotType] || SHOT_PROMPTS_BATCH['Front'];
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }
  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');
  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — place the model in this exact setting`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — extract ONLY the body stance, posture, and arm/leg positions from this image. The person and clothing in this image are irrelevant — use only the body pose.`
    : '';
  const prompt = `I am uploading ${images.length} reference images:\n1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}.\n${productLines}\n${bgLine}${poseLine ? '\n' + poseLine : ''}\n\nGenerate a photorealistic fashion photograph.\n\nCHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}.\nGARMENT: Reproduce the exact garment from the product reference image(s). CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — do NOT alter any structural design element between shots. Product: ${productName || 'fashion item'}.\nFOOTWEAR: Do NOT copy or reproduce footwear from any reference image — ignore the shoes on the model in reference image 1 and ignore any footwear visible in the product reference images. Default to simple nude pointed-toe heels unless a different footwear is specified in the global instruction. Apply the same footwear consistently across every shot in this set.\nSETTING: ${backgroundImageBase64 ? `reproduce the exact background from reference image ${bgIdx} — same environment, same colors, same tone, same lighting. This background must be identical across every shot. Do NOT alter, vary, or reinterpret it in any way. Ignore any background visible in the product reference images — only use the designated background reference.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. This exact white studio background must be identical across every shot. Do NOT use or be influenced by any background, floor color, or environment visible in the product reference images — those backgrounds must be completely ignored.'}.${effectivePose ? `\nPOSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.` : ''}\n\n${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (apply to all shots): ${globalInstruction}` : ''}\nSoft diffused studio lighting. Premium D2C fashion brand photography quality.\nNo text, no overlays, no watermarks.`;
  return {
    workflow: 'C',
    label: label || `PDP — ${shotType}`,
    images,
    prompt,
    aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
    resolution: resolution || '1080x1440',
    imageSize: getGeminiImageSize(quality || 'medium', model),
  };
}

export async function prepareBatchVirtualTryOn({ garmentImageBase64, personImageBase64, quality, resolution, label }) {
  const settings = await getSettings();
  const model = settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const prompt = `I am uploading 2 reference images:\n1. Person/model image - use this exact person, their face, body, skin tone and hair\n2. Garment image - dress this person in exactly this garment, every detail preserved\n\nGenerate a photorealistic photograph of the person wearing the garment naturally.\nThe garment should fit naturally on the person's body.\nKeep the person's face, hair, and non-garment features exactly as in reference image 1.\nNatural indoor or outdoor setting. Soft flattering lighting.\nNo text, no overlays, no watermarks.`;
  return {
    workflow: 'D',
    label: label || 'Virtual Try-On',
    images: [personImageBase64, garmentImageBase64],
    prompt,
    aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
    resolution: resolution || '1080x1440',
    imageSize: getGeminiImageSize(quality || 'medium', model),
  };
}

// ── Submit batch job ──────────────────────────────────────────────────────

export async function submitBatchJob(items) {
  const requests = items.map(item => ({
    prompt: item.prompt,
    images: item.images,
    aspectRatio: item.aspectRatio || '3:4',
  }));
  return await api.geminiBatchCreate({ requests });
}

export async function pollBatchJob(name) {
  return await api.geminiBatchGet({ name });
}

export async function cancelBatchJob(name) {
  return await api.geminiBatchCancel({ name });
}

// ── Workflow E: Category-aware PDP Shoot ─────────────────────────────────

const CATEGORY_ACTIONS = {
  full_outfit: {
    Front: 'Action: standing naturally, arms relaxed, looking slightly off camera. FULL BODY — entire figure from top of head to feet must be fully visible. Do NOT crop below the knees. Feet must be visible at the bottom of the frame.',
    Side:  'Action: model facing completely to the right. FULL BODY — entire figure from head to feet visible, shows garment silhouette. Do NOT crop below the knees. Feet must be visible.',
    Back:  'Action: model facing away from camera, hair swept to one side. FULL BODY — entire figure from head to feet visible. Do NOT crop below the knees. Feet must be visible.',
  },
  topwear: {
    Front: 'Action: 3/4 shot focusing on the upper garment. FRAMING — CRITICAL: This is NOT a full body shot. The bottom of the frame must end at hip or thigh level. Legs and feet must NOT be visible. Camera zoomed in to show the upper garment as the hero. Do NOT generate a full body image under any circumstances.',
    Side:  'Action: 3/4 side shot, model facing right, focusing on the upper garment. FRAMING — CRITICAL: This is NOT a full body shot. The bottom of the frame must end at hip or thigh level. Legs and feet must NOT be visible. Show the upper garment silhouette clearly. Do NOT generate a full body image.',
    Back:  'Action: 3/4 back shot, model facing away, focusing on the upper garment. FRAMING — CRITICAL: This is NOT a full body shot. The bottom of the frame must end at hip or thigh level. Legs and feet must NOT be visible. Show the back of the upper garment clearly. Do NOT generate a full body image.',
  },
  bottomwear: {
    Front: 'Action: 3/4 shot focusing on the lower garment. FRAMING — CRITICAL: This is NOT a full body shot. Frame from waist to feet — do NOT show above the waist. The lower garment is the hero. Show full legs and feet clearly.',
    Side:  'Action: 3/4 side shot, model facing right, focusing on the lower garment. FRAMING — CRITICAL: Frame from waist to feet. Do NOT show above the waist. Show the lower garment silhouette clearly.',
    Back:  'Action: 3/4 back shot, model facing away, focusing on the lower garment. FRAMING — CRITICAL: Frame from waist to feet. Do NOT show above the waist. Show the back of the lower garment clearly.',
  },
  innerwear: {
    Front: 'Action: 3/4 shot focusing on the innerwear. FRAMING — CRITICAL: This is NOT a full body shot. The bottom of the frame must end at hip or thigh level. Legs and feet must NOT be visible. Show the innerwear as the hero. Do NOT generate a full body image.',
    Side:  'Action: 3/4 side shot, model facing right, focusing on the innerwear. FRAMING — CRITICAL: The bottom of the frame must end at hip or thigh level. Legs and feet must NOT be visible. Do NOT generate a full body image.',
    Back:  'Action: 3/4 back shot, model facing away, focusing on the innerwear. FRAMING — CRITICAL: The bottom of the frame must end at hip or thigh level. Legs and feet must NOT be visible. Do NOT generate a full body image.',
  },
  outerwear: {
    Front: 'Action: standing naturally, arms relaxed, looking slightly off camera. FULL BODY — entire figure from top of head to feet must be fully visible. Do NOT crop below the knees. Feet must be visible.',
    Side:  'Action: model facing completely to the right. FULL BODY — entire figure from head to feet visible, shows outerwear silhouette. Do NOT crop below the knees. Feet must be visible.',
    Back:  'Action: model facing away from camera, hair swept to one side. FULL BODY — entire figure from head to feet visible. Do NOT crop below the knees. Feet must be visible.',
  },
  footwear: {
    Front: 'Action: tight shot focusing on the footwear. FRAMING — CRITICAL: Frame from knee to feet only. Do NOT show above the knee. The footwear is the hero. Show feet and lower legs clearly. Do NOT generate a full body image.',
    Side:  'Action: tight side shot, model facing right, focusing on the footwear. FRAMING — CRITICAL: Frame from knee to feet only. Do NOT show above the knee. Show footwear silhouette clearly from the side.',
    Back:  'Action: tight back shot, model facing away, focusing on the footwear. FRAMING — CRITICAL: Frame from knee to feet only. Do NOT show above the knee. Show the back of the footwear clearly.',
  },
};

const MODEL_IDENTITY_PREFIX = {
  Front:  'MODEL IDENTITY — NON-NEGOTIABLE: The ONLY person in this image must be the exact woman from reference image 1 — her face, skin tone, hair, and body. The person wearing the garment in the product reference images is a placeholder mannequin — their face and body must NOT appear in the output under any circumstances. Any other person\'s likeness is strictly forbidden.',
  Styled: 'MODEL IDENTITY — NON-NEGOTIABLE: The ONLY person in this image must be the exact woman from reference image 1 — her face, skin tone, hair, and body. The person shown wearing the garment in the product reference images is a placeholder mannequin — their face and body must NOT appear in the output under any circumstances. The person in the pose reference image is also a placeholder — use ONLY their body stance and posture, never their face, skin tone, or garment.',
  Side:   'MODEL IDENTITY — NON-NEGOTIABLE: The ONLY person in this image must be the exact woman from reference image 1 — her face, skin tone, hair, and body. The person wearing the garment in the product reference images is a placeholder mannequin — their face and body must NOT appear in the output under any circumstances. Any other person\'s likeness is strictly forbidden.',
  Back:   'MODEL IDENTITY — NON-NEGOTIABLE: The ONLY person in this image must be the exact woman from reference image 1 — her face, skin tone, hair, and body. The person wearing the garment in the product reference images is a placeholder mannequin — their face and body must NOT appear in the output under any circumstances. Any other person\'s likeness is strictly forbidden.',
  'Detail Close-Up': 'MODEL IDENTITY — NON-NEGOTIABLE: The ONLY person in this image must be the exact woman from reference image 1 — her face, skin tone, hair, and body. The person wearing the garment in the product reference images is a placeholder mannequin — their face and body must NOT appear in the output under any circumstances. Any other person\'s likeness is strictly forbidden.',
};

function buildShotPromptE(shotType, category) {
  const cat = category || 'full_outfit';
  const identity = MODEL_IDENTITY_PREFIX[shotType] || MODEL_IDENTITY_PREFIX['Front'];
  const lighting = 'LIGHTING: Lighting intensity, color temperature, and overall brightness must be identical to every other shot in this set — no shot should appear brighter, darker, warmer, or cooler than the others. The model must look naturally lit within the scene, not composited onto it.';
  const shadow = 'SHADOW: The model must cast a natural shadow consistent with the ambient light — this anchors her physically in the space.';
  const bgLock = 'BACKGROUND: keep the exact same background as specified in SETTING — do not alter the background color, tone, or environment in any way.';
  const framingLock = 'FRAMING IS NON-NEGOTIABLE: The camera distance and model scale defined for this shot type must not change based on the background. Do NOT zoom out or pull the camera back to show more of the environment. The background must fit within the model\'s required framing — not the other way around.';

  if (shotType === 'Styled') {
    return `${identity} Action: editorial lifestyle pose — creative, natural, and expressive. The model should look candid and editorial, not stiff. Mood: aspirational fashion campaign. FULL BODY — entire figure visible. FRAMING: The model should occupy at least 65% of the frame height — medium to medium-wide shot. BACKGROUND: Keep the exact background as specified in SETTING — do not alter the color, tone, or environment in any way. GARMENT FIDELITY — CRITICAL: The garment must be reproduced EXACTLY from the product reference images — same color, same print, same pattern, same construction. Do NOT change the garment color, print scale, print density, motifs, embellishments, hemline, neckline, or silhouette in any way. The pose reference image contains a person wearing a different garment — ignore that garment completely and reproduce ONLY the product garment from the product reference images. PRINT/PATTERN — NON-NEGOTIABLE: If the product has a print or pattern (buti, floral, stripes, checks, etc.), reproduce it at the EXACT same scale, color, density, and placement as shown in the product reference. Do NOT rescale, simplify, alter, or replace the print. Do NOT add borders, embroidery, or embellishments that are not present in the product reference. ${lighting} ${framingLock}`;
  }
  if (shotType === 'Detail Close-Up') {
    return `Action: ZOOM INTO THE ACTUAL GARMENT on the model. ${identity} Do NOT reimagine, reconstruct, add, or exaggerate any garment detail. Do not over-emphasize seams or stitching beyond what is visible in the reference. Do NOT add smocking, gathering, shirring, elastic, ruffles, or any embellishment at the waist or any other area that is not clearly visible in the reference images — if the garment has a plain seam at the waist, keep it as a plain seam. CRITICAL: The garment color must exactly match the color in all reference images — do not shift, darken, or alter the hue in any way. FOOTWEAR NOTE: Do NOT alter the framing of this shot to show footwear — only include footwear if feet fall naturally within the detail area being shown. Do not zoom out or reframe to accommodate shoes. ${lighting} ${framingLock}`;
  }

  const actions = CATEGORY_ACTIONS[cat] || CATEGORY_ACTIONS['full_outfit'];
  const action = actions[shotType] || actions['Front'];
  const extraBg = (shotType === 'Side' || shotType === 'Back') ? bgLock + ' ' : '';
  const extraShadow = (shotType === 'Side' || shotType === 'Back') ? shadow : '';

  return `${identity} ${action} ${extraBg}${lighting} ${extraShadow} ${framingLock}`.trim();
}

export async function generatePDPShotE({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, category, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, apiSize, resolution, skipGemini }) {
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';
  const effectivePose = (shotType === 'Styled' && !shotInstruction) ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  let shotPrompt = buildShotPromptE(shotType, category);
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }

  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');
  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — place the model in this exact setting`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — extract ONLY the body stance, posture, and arm/leg positions from this image. The person and clothing in this image are irrelevant — use only the body pose.`
    : '';

  const prompt = `I am uploading ${images.length} reference images:
1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}. Do NOT use the face or body of anyone in the product images.
${productLines}
${bgLine}${poseLine ? '\n' + poseLine : ''}

Generate a photorealistic fashion photograph in 2:3 portrait format.

CHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}. Replace any other person entirely.
GARMENT: Reproduce the exact garment from the product reference image(s). Every design detail, color, print pattern, and construction must be accurate. CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue in any way. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — sleeve length, sleeve style, collar, cuffs, hemline, and all structural elements must be reproduced exactly as shown in the reference. Do NOT alter any construction detail between shots. PRINT/PATTERN SCALE — CRITICAL: Whatever pattern the garment has (stripes, checks, prints, motifs, or any repeating element), reproduce it at the EXACT same scale, width, spacing, and density as it appears in the reference images. Do NOT rescale, compress, reinterpret, or simplify the pattern in any way. Wide stripes stay wide. Large checks stay large. Bold motifs stay bold. The pattern colors must be copied exactly from the reference — do NOT substitute, brighten, saturate, or shift any hue (e.g. off-white ≠ white, blue-grey ≠ navy, ivory ≠ cream). COLLAR AND CONSTRUCTION — CRITICAL: The collar type, sleeve style, cuffs, buttons, hemline, and overall silhouette must be reproduced exactly from the reference. Do NOT change the collar to a different style — a shirt collar stays a shirt collar, a band collar stays a band collar. Copy every construction detail from the reference. Product: ${productName || 'fashion item'}.
FOOTWEAR: Do NOT copy or reproduce footwear from any reference image — ignore the shoes on the model in reference image 1 and ignore any footwear visible in the product reference images. Default to simple nude pointed-toe heels unless a different footwear is specified in the global instruction. Apply the same footwear consistently across every shot in this set.
SETTING: ${backgroundImageBase64 ? `reproduce the exact background from reference image ${bgIdx} — same environment, same colors, same tone, same lighting. This background must be identical across every shot. Do NOT alter, vary, or reinterpret it in any way. Ignore any background visible in the product reference images — only use the designated background reference. PHOTOGRAPHIC STYLE MATCHING — CRITICAL: Match the photographic rendering style, texture, and color grading of the background exactly. The model must look like she was physically photographed in that location — not composited onto it. Adjust the lighting on the model to match the ambient light, color temperature, shadow direction, and overall luminosity of the background scene. Edges between model and background must be photo-realistic, not cut-out or sharp-masked.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. This exact white studio background must be identical across every shot. Do NOT use or be influenced by any background visible in the product reference images. The model must look naturally and evenly lit within this studio environment.'}.${effectivePose ? `\nPOSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.` : ''}

${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (apply to all shots): ${globalInstruction}` : ''}
Premium D2C fashion brand photography quality.
2:3 portrait format. No text, no overlays, no watermarks.`;

  if (!skipGemini) {
    return await callGemini({ images, prompt, quality: q, resolution });
  }
  const apiKey = await getApiKey();
  return await api.multiImageGenerate({ apiKey, images, prompt, quality: q, size: sz });
}

export async function prepareBatchPDPShotE({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, category, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, resolution, label, model: modelOverride, _settings }) {
  const settings = _settings || await getSettings();
  const model = modelOverride || settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const effectivePose = (shotType === 'Styled' && !shotInstruction) ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  let shotPrompt = buildShotPromptE(shotType, category);
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }

  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');
  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — place the model in this exact setting`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — extract ONLY the body stance, posture, and arm/leg positions from this image. The person and clothing in this image are irrelevant — use only the body pose.`
    : '';

  const prompt = `I am uploading ${images.length} reference images:\n1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}.\n${productLines}\n${bgLine}${poseLine ? '\n' + poseLine : ''}\n\nGenerate a photorealistic fashion photograph.\n\nCHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}.\nGARMENT: Reproduce the exact garment from the product reference image(s). CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — sleeve length, sleeve style, collar, cuffs, hemline, and all structural elements must be reproduced exactly as shown in the reference. Do NOT alter any construction detail between shots. PRINT/PATTERN SCALE — CRITICAL: Whatever pattern the garment has (stripes, checks, prints, motifs, or any repeating element), reproduce it at the EXACT same scale, width, spacing, and density as it appears in the reference images. Do NOT rescale, compress, reinterpret, or simplify the pattern in any way. Wide stripes stay wide. Large checks stay large. Bold motifs stay bold. The pattern colors must be copied exactly from the reference — do NOT substitute, brighten, saturate, or shift any hue (e.g. off-white ≠ white, blue-grey ≠ navy, ivory ≠ cream). COLLAR AND CONSTRUCTION — CRITICAL: The collar type, sleeve style, cuffs, buttons, hemline, and overall silhouette must be reproduced exactly from the reference. Do NOT change the collar to a different style — a shirt collar stays a shirt collar, a band collar stays a band collar. Copy every construction detail from the reference. Product: ${productName || 'fashion item'}.\nFOOTWEAR: Do NOT copy or reproduce footwear from any reference image — ignore the shoes on the model in reference image 1 and ignore any footwear visible in the product reference images. Default to simple nude pointed-toe heels unless a different footwear is specified in the global instruction. Apply the same footwear consistently across every shot in this set.\nSETTING: ${backgroundImageBase64 ? `reproduce the exact background from reference image ${bgIdx} — same environment, same colors, same tone, same lighting. This background must be identical across every shot. Do NOT alter, vary, or reinterpret it. Ignore any background visible in the product reference images. PHOTOGRAPHIC STYLE MATCHING — CRITICAL: Match the photographic rendering style, texture, and color grading of the background exactly. The model must look like she was physically photographed in that location — not composited onto it. Adjust the lighting on the model to match the ambient light, color temperature, shadow direction, and overall luminosity of the background scene. Edges between model and background must be photo-realistic, not cut-out or sharp-masked.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. Identical across every shot. Do NOT be influenced by any background in the product reference images. The model must look naturally and evenly lit within this studio environment.'}.${effectivePose ? `\nPOSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.` : ''}\n\n${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (apply to all shots): ${globalInstruction}` : ''}\nPremium D2C fashion brand photography quality.\nNo text, no overlays, no watermarks.`;

  return {
    workflow: 'E',
    label: label || `PDP-E — ${shotType}`,
    images,
    prompt,
    aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
    resolution: resolution || '1080x1440',
    imageSize: getGeminiImageSize(quality || 'medium', model),
  };
}

// ── File naming ───────────────────────────────────────────────────────────

export function generateFileName(productName, modelType, shotType) {
  const clean = (str) => (str || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = Date.now();
  return `${clean(productName)}_${clean(modelType)}_${clean(shotType)}_${timestamp}.png`;
}
