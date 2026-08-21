// ── Resolution Presets ────────────────────────────────────────────────────
// The OpenAI API only supports 3 sizes: 1024×1024, 1024×1536, 1536×1024.
// Gemini supports any aspect ratio natively — no cropping needed.
// width/height = null means skip sharp and save at native AI output resolution.

export const RESOLUTION_PRESETS = [
  // 1K (For Batch)
  { group: '1K (For Batch)', label: '896 x 1200 - Portrait (3:4)', value: '896x1200_1K', width: null, height: null, apiSize: '1024x1536', geminiRatio: '3:4', geminiQuality: 'low' },
  { group: '1K (For Batch)', label: '1080 x 1440 - Portrait (3:4, Myntra Min)', value: '1080x1440_1K', width: 1080, height: 1440, apiSize: '1024x1536', geminiRatio: '3:4', geminiQuality: 'low' },
  { group: '1K (For Batch)', label: '928 x 1152 - Portrait (4:5)', value: '928x1152_1K', width: null, height: null, apiSize: '1024x1536', geminiRatio: '4:5', geminiQuality: 'low' },
  { group: '1K (For Batch)', label: '768 x 1376 - Vertical (9:16)', value: '768x1376_1K', width: null, height: null, apiSize: '1024x1536', geminiRatio: '9:16', geminiQuality: 'low' },
  { group: '1K (For Batch)', label: '1024 x 1024 - Square (1:1)', value: '1024x1024_1K', width: null, height: null, apiSize: '1024x1024', geminiRatio: '1:1', geminiQuality: 'low' },
  { group: '1K (For Batch)', label: '1376 x 768 - Landscape (16:9)', value: '1376x768_1K', width: null, height: null, apiSize: '1536x1024', geminiRatio: '16:9', geminiQuality: 'low' },
  { group: '1K (For Batch)', label: '1200 x 896 - Landscape (4:3)', value: '1200x896_1K', width: null, height: null, apiSize: '1536x1024', geminiRatio: '4:3', geminiQuality: 'low' },

  // 2K (For High Res)
  { group: '2K (For High Res)', label: '1792 x 2400 - Portrait (3:4)', value: '1792x2400_2K', width: null, height: null, apiSize: '1024x1536', geminiRatio: '3:4', geminiQuality: 'medium' },
  { group: '2K (For High Res)', label: '1856 x 2304 - Portrait (4:5)', value: '1856x2304_2K', width: null, height: null, apiSize: '1024x1536', geminiRatio: '4:5', geminiQuality: 'medium' },
  { group: '2K (For High Res)', label: '1536 x 2752 - Vertical (9:16)', value: '1536x2752_2K', width: null, height: null, apiSize: '1024x1536', geminiRatio: '9:16', geminiQuality: 'medium' },
  { group: '2K (For High Res)', label: '2048 x 2048 - Square (1:1)', value: '2048x2048_2K', width: null, height: null, apiSize: '1024x1024', geminiRatio: '1:1', geminiQuality: 'medium' },
  { group: '2K (For High Res)', label: '2752 x 1536 - Landscape (16:9)', value: '2752x1536_2K', width: null, height: null, apiSize: '1536x1024', geminiRatio: '16:9', geminiQuality: 'medium' },
  { group: '2K (For High Res)', label: '2400 x 1792 - Landscape (4:3)', value: '2400x1792_2K', width: null, height: null, apiSize: '1536x1024', geminiRatio: '4:3', geminiQuality: 'medium' },

  // Custom
  { group: 'Custom', label: 'Custom...', value: 'custom', width: null, height: null, apiSize: '1024x1536', geminiRatio: '3:4', geminiQuality: 'medium' },
];

export const DEFAULT_RESOLUTION = '1080x1440_1K';

// ── Helpers ───────────────────────────────────────────────────────────────

// Derive OpenAI apiSize from dimensions
function deriveApiSize(w, h) {
  if (!w || !h) return '1024x1536';
  if (w > h) return '1536x1024';
  if (w === h) return '1024x1024';
  return '1024x1536';
}

// Derive closest Gemini-supported aspect ratio from dimensions
function deriveGeminiRatio(w, h) {
  if (!w || !h) return '3:4';
  const ratio = w / h;
  const supported = [
    { r: '1:1', v: 1 }, { r: '4:5', v: 0.8 }, { r: '3:4', v: 0.75 },
    { r: '2:3', v: 0.667 }, { r: '9:16', v: 0.5625 },
    { r: '4:3', v: 1.333 }, { r: '5:4', v: 1.25 }, { r: '3:2', v: 1.5 }, { r: '16:9', v: 1.778 },
  ];
  return supported.reduce((best, curr) =>
    Math.abs(curr.v - ratio) < Math.abs(best.v - ratio) ? curr : best
  ).r;
}

// Return a preset object by value string.
// Handles 'custom:WxH' encoded values from the custom input.
export function getResolution(value) {
  if (value && value.startsWith('custom:')) {
    const [w, h] = value.replace('custom:', '').split('x').map(Number);
    return { value, width: w || 1080, height: h || 1440, apiSize: deriveApiSize(w, h), geminiRatio: deriveGeminiRatio(w, h) };
  }
  return RESOLUTION_PRESETS.find(r => r.value === value) || RESOLUTION_PRESETS[0];
}

// ── Gemini helpers ────────────────────────────────────────────────────────

// Get Gemini aspect ratio from a resolution value string
export function getGeminiAspectRatio(resolutionValue) {
  const preset = getResolution(resolutionValue);
  return preset.geminiRatio || '3:4';
}

// Map quality → Gemini imageSize param
// Flash: 0.5K=747t, 1K/2K=1120t (same cost!), 4K=2000t
// Pro:   1K/2K=1120t (same cost!), 4K=2000t — no 0.5K tier
// → Low=0.5K on Flash (draft), Low=1K on Pro (same cost as 2K — discouraged in UI)
// → Medium always uses 2K (best value: same cost as 1K, double the resolution)
// → High=4K (only if you need print quality)
export function getGeminiImageSize(quality, model, resolutionValue) {
  let q = quality;
  if (!q && resolutionValue) {
    const preset = getResolution(resolutionValue);
    q = preset.geminiQuality;
  }
  q = q || 'medium';

  const isPro = model === 'gemini-3-pro-image';
  if (q === 'low') return isPro ? '1K' : '1K'; // We force 1K now instead of 0.5K, as 1K is needed for Myntra etc
  if (q === 'high') return '4K';
  return '2K'; // medium
}
