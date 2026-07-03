import { getSettings } from './storage';
import { getGeminiAspectRatio, getGeminiImageSize } from './constants';

// Lazy proxy — reads window.electronAPI at call time, not at module load time
// (ES module imports are evaluated before installWebShim() runs in index.js)
const api = new Proxy({}, { get: (_, k) => (...args) => window.electronAPI[k](...args) });

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

// ── Prompt template cache ──────────────────────────────────────────────────
let _promptTemplates = null;

export async function getPromptTemplates() {
  if (_promptTemplates) return _promptTemplates;
  try {
    const token = localStorage.getItem('shootai_token');
    const res = await fetch(`${SERVER_URL}/api/prompt-templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) _promptTemplates = await res.json();
  } catch {}
  return _promptTemplates || {};
}

export function invalidatePromptTemplates() {
  _promptTemplates = null;
}

// Expose invalidate on window so AdminPanel can call it without importing api.js
if (typeof window !== 'undefined') {
  window.__invalidatePromptTemplates = invalidatePromptTemplates;
}

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
      ? `I am uploading 2 images:\n1. ORIGINAL photo — preserve the person, pose, outfit, props, and lighting EXACTLY\n2. Background reference — reproduce this background EXACTLY: same wall color, same floor color, same surface textures, same overall tone. Do NOT reinterpret or alter any colors.\n\nCRITICAL: Do NOT change the person's face, pose, clothing, accessories, or lighting. ONLY swap the background.\n\nBACKGROUND REPRODUCTION — NON-NEGOTIABLE: The background from reference image 2 must be reproduced EXACTLY — same wall color, same floor color, same surface texture, same tone. Do NOT alter, shift, or reinterpret the background colors in any way.\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop or object in the scene — whether held by the model, touching the model, or placed nearby — must be preserved exactly in their original position. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model, or any object in the scene. ONLY the background wall and floor/ground surface may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`
      : `Replace ONLY the background of this photo with: ${bgDesc}\n\nCRITICAL: Do NOT change the person's face, expression, pose, clothing, accessories, or lighting direction. ONLY change the background/environment behind the person.\n\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop or object in the scene — whether held by the model, touching the model, or placed nearby — must be preserved exactly in their original position. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model, or any object in the scene. ONLY the background wall and floor/ground surface may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`;
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

PRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop or object in the scene — whether held by the model, touching the model, or placed nearby — must be preserved exactly in their original position. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model, or any object in the scene. ONLY the background wall and floor/ground surface may change.
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

PRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop or object in the scene — whether held by the model, touching the model, or placed nearby — must be preserved exactly in their original position. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model, or any object in the scene. ONLY the background wall and floor/ground surface may change.
NATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.

No text, no watermarks.`,
    size: sz,
    quality: q,
  });
}

// ── Workflow B: Change Model ───────────────────────────────────────────────

export async function changeModel({ productImageBase64, modelImageBase64, quality, apiSize, resolution, skipGemini }) {
  const t = await getPromptTemplates();
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';

  if (!skipGemini) {
    return await callGemini({
      images: [modelImageBase64, productImageBase64],
      prompt: `I am uploading 2 reference images:\n1. Model reference - use this exact woman's face, body structure, skin tone and hair\n2. Product image - reproduce this exact garment on the model in every detail\n\nGenerate a photorealistic studio fashion photograph.\nCHARACTER: exact woman from reference image 1.\n${(t.b_core_prompt||'GARMENT: Reproduce exact garment from reference image 2 — every design detail, color, and construction accurate.')} ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''}\nSETTING: clean white studio background.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nSoft diffused lighting. Premium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks.`,
      quality: q, resolution,
    });
  }

  const apiKey = await getApiKey();
  return await api.multiImageGenerate({
    apiKey,
    images: [modelImageBase64, productImageBase64],
    prompt: `I am uploading 2 reference images:\n1. Model reference - use this exact woman's face, body structure, skin tone and hair\n2. Product image - reproduce this exact garment on the model in every detail\n\nGenerate a photorealistic studio fashion photograph in 2:3 portrait format.\nCHARACTER: exact woman from reference image 1.\n${(t.b_core_prompt||'GARMENT: Reproduce exact garment from reference image 2 — every design detail, color, and construction accurate.')} ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''}\nSETTING: clean white studio background.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nSoft diffused lighting. Premium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks.`,
    quality: q,
    size: sz,
  });
}

// ── Workflow C: Full PDP Shoot ─────────────────────────────────────────────

export async function generatePDPShot({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, apiSize, resolution, skipGemini }) {
  const t = await getPromptTemplates();
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';
  const go = t.garment_orientation || {};
  const sp = t.c_shot_prompts || {};
  let shotPrompt = (go[shotType] ? go[shotType] + ' ' : '') + (sp[shotType] || sp['Front'] || '');
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }

  const effectivePose = shotType === 'Styled' ? poseImageBase64 : null;

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
    ? `${bgIdx}. Background reference — the EXACT wall color, floor color, and environment to reproduce. Same hue, same saturation, same brightness as shown. FIXED CONSTANT — do NOT recolor, relight, or reinterpret.`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — MANDATORY pose blueprint. Copy the exact joint angles, arm bend, hip shift, shoulder tilt, leg position, and weight distribution precisely. The person and clothing in this image are irrelevant — use ONLY the body pose as a blueprint.`
    : '';

  const prompt = `I am uploading ${images.length} reference images:
1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}. Do NOT use the face or body of anyone in the product images.
${productLines}
${bgLine}${poseLine ? '\n' + poseLine : ''}

Generate a photorealistic fashion photograph in 2:3 portrait format.

CHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}. Replace any other person entirely.
GARMENT: ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''} Reproduce the exact garment from the product reference image(s). Every design detail, color, print pattern, and construction must be accurate. CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue in any way. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — do NOT alter any structural design element between shots. Product: ${productName || 'fashion item'}.
FOOTWEAR: ${(t.global||{}).footwear_block||''}
SETTING: ${backgroundImageBase64 ? `reproduce the EXACT background from reference image ${bgIdx} — the wall color, floor color, and environment must match pixel-perfectly: same hue, same saturation, same brightness. The background is a FIXED CONSTANT — do NOT recolor, relight, warm, cool, or shift it based on the model's pose or angle. Only the lighting ON THE MODEL adapts to the background — never the other way around. Ignore any background visible in the product reference images.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. This exact white studio background must be identical across every shot. Do NOT use or be influenced by any background, floor color, or environment visible in the product reference images — those backgrounds must be completely ignored.'}.${effectivePose ? `\nPOSE: Copy the EXACT pose from reference image ${poseIdx} — mirror the precise joint angles, arm positions, hip tilt, shoulder angle, leg stance, weight distribution, and foot placement exactly as shown. This is NON-NEGOTIABLE. Do NOT simplify, straighten, or reinterpret the pose in any way. Do NOT default to a generic standing pose. Every body angle must match the reference precisely.` : ''}

${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (applies ONLY to styling, mood expression, and accessories — does NOT override model identity, garment, or background): ${globalInstruction}` : ''}
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
  const t = await getPromptTemplates();
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';

  const prompt = `I am uploading 2 reference images:
1. Person/model image - use this exact person, their face, body, skin tone and hair
2. Garment image - dress this person in exactly this garment, every detail preserved

Generate a photorealistic photograph of the person wearing the garment naturally.
${(t.d_core_prompt||'The garment should fit naturally on the person\'s body.')} ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''}
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
    ? `I am uploading 2 images:\n1. ORIGINAL photo — preserve the person, pose, outfit, props, and lighting EXACTLY\n2. Background reference — the EXACT wall color, floor color, and environment to use. Reproduce it pixel-perfectly — same hue, same saturation, same brightness as shown in this reference image.\n\nCRITICAL: Do NOT change the person's face, pose, clothing, accessories, or lighting. ONLY swap the background.\n\nBACKGROUND COLOR — NON-NEGOTIABLE: The wall color and floor color from reference image 2 must appear EXACTLY as they do in that reference image — same hue, same saturation, same brightness. Do NOT recolor, relight, warm, cool, darken, or shift the background in any way. The background is a FIXED CONSTANT. Only the lighting on the model adapts to match the background — never the other way around.\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop or object in the scene — whether held by the model, touching the model, or placed nearby — must be preserved exactly in their original position. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model, or any object in the scene. ONLY the background wall and floor/ground surface may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Adapt ONLY the lighting direction, color temperature, and ambient fill ON THE MODEL to match the background — do NOT alter the background colors themselves. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked.\n\nNo text, no watermarks.`
    : `Replace ONLY the background of this photo with: ${bgDesc}\n\nCRITICAL: Do NOT change the person's face, expression, pose, clothing, accessories, or lighting direction. ONLY change the background/environment behind the person.\n\nPRESERVATION — NON-NEGOTIABLE: Every pixel of the model must remain identical — her face, skin tone, expression, hair, body, pose, and clothing must not change in any way. All accessories, jewelry, watches, bags, footwear, and any prop or object in the scene — whether held by the model, touching the model, or placed nearby — must be preserved exactly in their original position. Do NOT alter, smooth, recolor, or reinterpret anything on or attached to the model, or any object in the scene. ONLY the background wall and floor/ground surface may change.\nNATURAL INTEGRATION: The model must look naturally lit within the new environment, not composited onto it. Lighting direction, color temperature, and ambient fill on the model must match the new background. The model must cast a natural ground shadow consistent with the scene's light source. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. The result must look like the photo was taken in this environment. Adapt the lighting on the model to naturally match the new background environment — adjust the color temperature, shadow direction, highlight intensity, and overall luminosity on the model so it is consistent with the ambient light of the new scene. The model should appear as if physically present in the new location, not photographed separately.\n\nNo text, no watermarks.`;
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
  const t = await getPromptTemplates();
  const settings = await getSettings();
  const model = settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const images = [modelImageBase64, productImageBase64];
  const prompt = `I am uploading 2 reference images:\n1. Model reference - use this exact woman's face, body structure, skin tone and hair\n2. Product image - reproduce this exact garment on the model in every detail\n\nGenerate a photorealistic studio fashion photograph.\nCHARACTER: exact woman from reference image 1.\n${(t.b_core_prompt||'GARMENT: Reproduce exact garment from reference image 2 — every design detail, color, and construction accurate.')} ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''}\nSETTING: clean white studio background.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nSoft diffused lighting. Premium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks.`;
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
  const t = await getPromptTemplates();
  const settings = await getSettings();
  const model = modelOverride || settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const effectivePose = shotType === 'Styled' ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  const go = t.garment_orientation || {};
  const c_batch = (t.c_shot_prompts_batch || {});
  let shotPrompt = (go[shotType] ? go[shotType] + ' ' : '') + (c_batch[shotType] || c_batch['Front'] || '');
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }
  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');
  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — the EXACT wall color, floor color, and environment to reproduce. Same hue, same saturation, same brightness as shown. FIXED CONSTANT — do NOT recolor, relight, or reinterpret.`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — MANDATORY pose blueprint. Copy the exact joint angles, arm bend, hip shift, shoulder tilt, leg position, and weight distribution precisely. The person and clothing in this image are irrelevant — use ONLY the body pose as a blueprint.`
    : '';
  const prompt = `I am uploading ${images.length} reference images:\n1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}.\n${productLines}\n${bgLine}${poseLine ? '\n' + poseLine : ''}\n\nGenerate a photorealistic fashion photograph.\n\nCHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}.\nGARMENT: ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''} Reproduce the exact garment from the product reference image(s). CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — do NOT alter any structural design element between shots. Product: ${productName || 'fashion item'}.\nFOOTWEAR: ${(t.global||{}).footwear_block||''}\nSETTING: ${backgroundImageBase64 ? `reproduce the EXACT background from reference image ${bgIdx} — the wall color, floor color, and environment must match pixel-perfectly: same hue, same saturation, same brightness. The background is a FIXED CONSTANT — do NOT recolor, relight, warm, cool, or shift it based on the model's pose or angle. Only the lighting ON THE MODEL adapts to the background — never the other way around. Ignore any background visible in the product reference images.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. This exact white studio background must be identical across every shot. Do NOT use or be influenced by any background, floor color, or environment visible in the product reference images — those backgrounds must be completely ignored.'}.${effectivePose ? `\nPOSE: Copy the EXACT pose from reference image ${poseIdx} — mirror the precise joint angles, arm positions, hip tilt, shoulder angle, leg stance, weight distribution, and foot placement exactly as shown. This is NON-NEGOTIABLE. Do NOT simplify, straighten, or reinterpret the pose in any way. Do NOT default to a generic standing pose. Every body angle must match the reference precisely.` : ''}\n\n${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (applies ONLY to styling, mood expression, and accessories — does NOT override model identity, garment, or background): ${globalInstruction}` : ''}\nSoft diffused studio lighting. Premium D2C fashion brand photography quality.\nNo text, no overlays, no watermarks.`;
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
  const t = await getPromptTemplates();
  const settings = await getSettings();
  const model = settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const prompt = `I am uploading 2 reference images:\n1. Person/model image - use this exact person, their face, body, skin tone and hair\n2. Garment image - dress this person in exactly this garment, every detail preserved\n\nGenerate a photorealistic photograph of the person wearing the garment naturally.\n${(t.d_core_prompt||'The garment should fit naturally on the person\'s body.')} ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''}\nKeep the person's face, hair, and non-garment features exactly as in reference image 1.\nNatural indoor or outdoor setting. Soft flattering lighting.\nNo text, no overlays, no watermarks.`;
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

// Resize a base64 image to max `maxPx` on the longest side before upload.
// Dramatically reduces payload size — Gemini only needs to understand the product,
// not pixel-perfect full-res images.
function resizeImageBase64(base64, maxPx = 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxPx && h <= maxPx) { resolve(base64); return; }
      const scale = maxPx / Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(base64); // fallback: send original
    img.src = base64;
  });
}

export async function submitBatchJob(items) {
  // Resize all reference images in parallel before sending — keeps payload small
  const requests = await Promise.all(items.map(async item => {
    const resizedImages = await Promise.all((item.images || []).map(img => resizeImageBase64(img, 1024)));
    return {
      prompt: item.prompt,
      images: resizedImages,
      aspectRatio: item.aspectRatio || '3:4',
    };
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

async function buildShotPromptE(shotType, category, hasPose = false, t, lightingPreset = null) {
  const cat = category || 'full_outfit';
  const identity = (t.model_identity||{})[shotType] || (t.model_identity||{})['Front'] || '';
  const lighting = lightingPreset?.lighting || (t.e_shared||{}).lighting || '';
  const shadow = lightingPreset?.shadow || (t.e_shared||{}).shadow || '';
  const bgLock = (t.e_shared||{}).bgLock || '';
  const framingLock = (t.e_shared||{}).framingLock || '';

  if (shotType === 'Styled') {
    const poseAction = hasPose
      ? ((t.e_styled||{}).pose_action_with_pose || '')
      : ((t.e_styled||{}).pose_action_without_pose || '');
    return `${(t.garment_orientation||{})['Styled'] || ''} ${(t.e_styled||{}).garment_absolute_lock || ''} ${(t.global||{}).garment_shape_lock || ''} ${(t.e_styled||{}).garment_accessories || ''} ${identity} ${poseAction} ${(t.e_styled||{}).framing || ''} ${bgLock} ${(t.e_styled||{}).garment_fidelity || ''} ${(t.e_styled||{}).print_lock || ''} ${lighting} ${shadow} ${framingLock}`;
  }
  if (shotType === 'Detail Close-Up') {
    return `${(t.e_detail_closeup||{}).action || ''} ${identity} ${(t.e_detail_closeup||{}).body || ''} ${bgLock} ${lighting} ${framingLock}`;
  }

  const catActions = (t.e_category_actions||{})[cat] || (t.e_category_actions||{})['full_outfit'] || {};
  const action = catActions[shotType] || catActions['Front'] || '';
  const extraShadow = shadow; // all standard shots get shadow (Detail Close-Up and Styled handled in their own branches)

  return `${(t.garment_orientation||{})[shotType] ? (t.garment_orientation||{})[shotType] + ' ' : ''}${identity} ${action} ${(t.global||{}).garment_shape_lock || ''} ${(t.global||{}).print_lock_angle || ''} ${bgLock} ${lighting} ${extraShadow} ${framingLock}`.trim();
}

export async function generatePDPShotE({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, category, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, apiSize, resolution, skipGemini, lightingPresetId }) {
  const t = await getPromptTemplates();
  const lightingPreset = (t.lighting_presets || []).find(p => p.id === lightingPresetId) || null;
  const settings = await getSettings();
  const q = quality || settings.defaultQuality || 'high';
  const sz = apiSize || '1024x1536';
  const effectivePose = shotType === 'Styled' ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  let shotPrompt = await buildShotPromptE(shotType, category, !!effectivePose, t, lightingPreset);
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }

  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');
  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — the EXACT wall color, floor color, and environment to reproduce. Same hue, same saturation, same brightness as shown. FIXED CONSTANT — do NOT recolor, relight, or reinterpret.`
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
GARMENT: ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''} Reproduce the exact garment from the product reference image(s). Every design detail, color, print pattern, and construction must be accurate. CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue in any way. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — sleeve length, sleeve style, collar, cuffs, hemline, and all structural elements must be reproduced exactly as shown in the reference. Do NOT alter any construction detail between shots. PRINT/PATTERN SCALE — CRITICAL: Whatever pattern the garment has (stripes, checks, prints, motifs, or any repeating element), reproduce it at the EXACT same scale, width, spacing, and density as it appears in the reference images. Do NOT rescale, compress, reinterpret, or simplify the pattern in any way. Wide stripes stay wide. Large checks stay large. Bold motifs stay bold. The pattern colors must be copied exactly from the reference — do NOT substitute, brighten, saturate, or shift any hue (e.g. off-white ≠ white, blue-grey ≠ navy, ivory ≠ cream). COLLAR AND CONSTRUCTION — CRITICAL: The collar type, sleeve style, cuffs, buttons, hemline, and overall silhouette must be reproduced exactly from the reference. Do NOT change the collar to a different style — a shirt collar stays a shirt collar, a band collar stays a band collar. Copy every construction detail from the reference. SLITS AND VENTS — CRITICAL: If the garment has any side slits, back vents, front slits, or any hem openings, reproduce them exactly — same side (left/right), same depth, same position. Do NOT omit, close, or hide any slit or vent visible in the reference images. These must appear in every shot angle where that part of the garment is visible. STRIPE DIRECTION AND PANEL LAYOUT — CRITICAL: If the garment has directional stripe panels (mitered seams, chevron sections, diagonal panels, or panels running in different directions), reproduce the exact direction, angle, and panel layout from the reference. Do NOT simplify directional stripe panels into uniform stripes — a mitered chevron yoke stays a mitered chevron yoke, diagonal side panels stay diagonal. Product: ${productName || 'fashion item'}.
FOOTWEAR: ${(t.global||{}).footwear_block||''}
SETTING: ${backgroundImageBase64 ? `reproduce the EXACT background from reference image ${bgIdx} — the wall color, floor color, and environment must match pixel-perfectly: same hue, same saturation, same brightness. The background is a FIXED CONSTANT — do NOT recolor, relight, warm, cool, or shift it based on the model's pose or angle. Only the lighting ON THE MODEL adapts to the background — never the other way around. Ignore any background visible in the product reference images. PHOTOGRAPHIC STYLE MATCHING — CRITICAL: Match the photographic rendering style, texture, and color grading of the background exactly. The model must look like she was physically photographed in that location — not composited onto it. Adjust the lighting on the model to match the ambient light, color temperature, shadow direction, and overall luminosity of the background scene. Edges between model and background must be photo-realistic, not cut-out or sharp-masked.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. This exact white studio background must be identical across every shot. Do NOT use or be influenced by any background visible in the product reference images. The model must look naturally and evenly lit within this studio environment.'}.${effectivePose ? `\nPOSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.` : ''}

${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (applies ONLY to styling, mood expression, and accessories — does NOT override model identity, garment, or background): ${globalInstruction}` : ''}
Premium D2C fashion brand photography quality.
2:3 portrait format. No text, no overlays, no watermarks.`;

  if (!skipGemini) {
    return await callGemini({ images, prompt, quality: q, resolution });
  }
  const apiKey = await getApiKey();
  return await api.multiImageGenerate({ apiKey, images, prompt, quality: q, size: sz });
}

export async function prepareBatchPDPShotE({ modelImageBase64, productImagesBase64, backgroundImageBase64, poseImageBase64, shotType, productName, category, modelBodyType, modelDescription, detailNote, globalInstruction, shotInstruction, quality, resolution, label, model: modelOverride, meta, _settings, lightingPresetId }) {
  const t = await getPromptTemplates();
  const settings = _settings || await getSettings();
  const lightingPreset = (t.lighting_presets || []).find(p => p.id === lightingPresetId) || null;
  const model = modelOverride || settings.geminiModel || 'gemini-2.0-flash-preview-image-generation';
  const effectivePose = shotType === 'Styled' ? poseImageBase64 : null;

  const productImages = Array.isArray(productImagesBase64) ? productImagesBase64 : [productImagesBase64];
  const images = [modelImageBase64, ...productImages];
  if (backgroundImageBase64) images.push(backgroundImageBase64);
  const bgIdx = images.length;
  if (effectivePose) images.push(effectivePose);
  const poseIdx = effectivePose ? images.length : null;

  let shotPrompt = await buildShotPromptE(shotType, category, !!effectivePose, t, lightingPreset);
  if (shotType === 'Detail Close-Up' && detailNote) {
    shotPrompt += ` CROP AREA: Show ONLY from ${detailNote} — frame the image tightly to this region. Do NOT show the full body. Do NOT show areas outside this crop zone.`;
  }

  const productCount = productImages.length;
  const productLines = productImages.map((_, i) =>
    `${i + 2}. Product reference image ${i + 1}${productCount > 1 ? ` (angle ${i + 1})` : ''} — for GARMENT DETAILS ONLY. Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.`
  ).join('\n');
  const bgLine = backgroundImageBase64
    ? `${bgIdx}. Background reference — the EXACT wall color, floor color, and environment to reproduce. Same hue, same saturation, same brightness as shown. This is a FIXED CONSTANT — do NOT recolor, relight, or reinterpret it.`
    : `Setting: clean professional photography studio`;
  const poseLine = effectivePose
    ? `${poseIdx}. Pose reference — extract ONLY the body stance, posture, and arm/leg positions from this image. The person and clothing in this image are irrelevant — use only the body pose.`
    : '';

  const prompt = `I am uploading ${images.length} reference images:\n1. MODEL reference — this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, and ${modelBodyType || 'body type'}.\n${productLines}\n${bgLine}${poseLine ? '\n' + poseLine : ''}\n\nGenerate a photorealistic fashion photograph.\n\nCHARACTER: ONLY the woman from reference image 1. ${modelBodyType || 'Hourglass'} body type${modelDescription ? ', ' + modelDescription : ''}.\nGARMENT: ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''} Reproduce the exact garment from the product reference image(s). CRITICAL: Preserve the EXACT color, shade, and tone of the garment — do not saturate, brighten, or shift the hue. If the garment has a print or pattern, reproduce it exactly — same motifs, same colors, same scale, same density, same placement. Do NOT simplify, reinterpret, or alter the print in any way. Do NOT add, move, or reinterpret any design element — if smocking, elastic, pleats, or any detail is not present on the front of the garment, do NOT place it on the front. Each design feature must appear only where it actually exists on the garment. If the garment has embroidery, zari work, mirror work, sequins, threadwork, or any surface embellishment, reproduce them exactly — same motifs, same placement, same colors, same scale, same density. Do NOT simplify, omit, or alter any surface embellishment in any way. The garment's neckline, silhouette, and overall construction must be identical across all angles — sleeve length, sleeve style, collar, cuffs, hemline, and all structural elements must be reproduced exactly as shown in the reference. Do NOT alter any construction detail between shots. PRINT/PATTERN SCALE — CRITICAL: Whatever pattern the garment has (stripes, checks, prints, motifs, or any repeating element), reproduce it at the EXACT same scale, width, spacing, and density as it appears in the reference images. Do NOT rescale, compress, reinterpret, or simplify the pattern in any way. Wide stripes stay wide. Large checks stay large. Bold motifs stay bold. The pattern colors must be copied exactly from the reference — do NOT substitute, brighten, saturate, or shift any hue (e.g. off-white ≠ white, blue-grey ≠ navy, ivory ≠ cream). COLLAR AND CONSTRUCTION — CRITICAL: The collar type, sleeve style, cuffs, buttons, hemline, and overall silhouette must be reproduced exactly from the reference. Do NOT change the collar to a different style — a shirt collar stays a shirt collar, a band collar stays a band collar. Copy every construction detail from the reference. SLITS AND VENTS — CRITICAL: If the garment has any side slits, back vents, front slits, or any hem openings, reproduce them exactly — same side (left/right), same depth, same position. Do NOT omit, close, or hide any slit or vent visible in the reference images. These must appear in every shot angle where that part of the garment is visible. STRIPE DIRECTION AND PANEL LAYOUT — CRITICAL: If the garment has directional stripe panels (mitered seams, chevron sections, diagonal panels, or panels running in different directions), reproduce the exact direction, angle, and panel layout from the reference. Do NOT simplify directional stripe panels into uniform stripes — a mitered chevron yoke stays a mitered chevron yoke, diagonal side panels stay diagonal. Product: ${productName || 'fashion item'}.\nFOOTWEAR: ${(t.global||{}).footwear_block||''}\nSETTING: ${backgroundImageBase64 ? `reproduce the EXACT background from reference image ${bgIdx} — the wall color, floor color, and environment must match pixel-perfectly: same hue, same saturation, same brightness. The background is a FIXED CONSTANT — do NOT recolor, relight, warm, cool, or shift it based on the model's pose or angle. Only the lighting ON THE MODEL adapts to the background — never the other way around. PHOTOGRAPHIC STYLE MATCHING — CRITICAL: Match the photographic rendering style, texture, and color grading of the background exactly. The model must look like she was physically photographed in that location — not composited onto it. Adjust the lighting on the model to match the ambient light, color temperature, shadow direction, and overall luminosity of the background scene. Edges between model and background must be photo-realistic, not cut-out or sharp-masked. Ignore any background visible in the product reference images.` : 'clean professional white studio — pure white walls and pure white floor, no grey, no off-white, no colored surfaces. Identical across every shot. Do NOT be influenced by any background in the product reference images. Do NOT be influenced by any background visible in the pose reference image. The model must look naturally and evenly lit within this studio environment.'}.${effectivePose ? `\nPOSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.` : ''}\n\n${shotPrompt}${shotInstruction ? `\nSPECIAL INSTRUCTION FOR THIS SHOT: ${shotInstruction}` : ''}${globalInstruction ? `\nGLOBAL INSTRUCTION (applies ONLY to styling, mood expression, and accessories — does NOT override model identity, garment, or background): ${globalInstruction}` : ''}\nPremium D2C fashion brand photography quality.\nNo text, no overlays, no watermarks.`;

  return {
    workflow: 'E',
    label: label || `PDP-E — ${shotType}`,
    images,
    prompt,
    aspectRatio: getGeminiAspectRatio(resolution || '1080x1440'),
    resolution: resolution || '1080x1440',
    imageSize: getGeminiImageSize(quality || 'medium', model),
    meta: meta || null,
  };
}

// ── File naming ───────────────────────────────────────────────────────────

export function generateFileName(productName, modelType, shotType) {
  const clean = (str) => (str || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = Date.now();
  return `${clean(productName)}_${clean(modelType)}_${clean(shotType)}_${timestamp}.png`;
}
