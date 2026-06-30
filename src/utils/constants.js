// ── Resolution Presets ────────────────────────────────────────────────────
// The OpenAI API only supports 3 sizes: 1024×1024, 1024×1536, 1536×1024.
// Gemini supports any aspect ratio natively — no cropping needed.
// width/height = null means skip sharp and save at native AI output resolution.

export const RESOLUTION_PRESETS = [
  // ─ Portrait ──────────────────────────────────────────────────────────
  { group: 'Portrait', label: '1080 × 1440  — D2C Standard (3:4)', value: '1080x1440', width: 1080, height: 1440, apiSize: '1024x1536', geminiRatio: '3:4' },
  { group: 'Portrait', label: '1080 × 1350  — Instagram Portrait (4:5)', value: '1080x1350', width: 1080, height: 1350, apiSize: '1024x1536', geminiRatio: '4:5' },
  { group: 'Portrait', label: '1080 × 1920  — Stories / Reels (9:16)', value: '1080x1920', width: 1080, height: 1920, apiSize: '1024x1536', geminiRatio: '9:16' },
  { group: 'Portrait', label: '1440 × 1920  — HD Portrait (3:4)', value: '1440x1920', width: 1440, height: 1920, apiSize: '1024x1536', geminiRatio: '3:4' },
  { group: 'Portrait', label: '1200 × 1800  — High Res (2:3)', value: '1200x1800', width: 1200, height: 1800, apiSize: '1024x1536', geminiRatio: '2:3' },
  // ─ Square ────────────────────────────────────────────────────────────
  { group: 'Square', label: '1080 × 1080  — Instagram Square (1:1)', value: '1080x1080', width: 1080, height: 1080, apiSize: '1024x1024', geminiRatio: '1:1' },
  { group: 'Square', label: '1440 × 1440  — HD Square (1:1)', value: '1440x1440', width: 1440, height: 1440, apiSize: '1024x1024', geminiRatio: '1:1' },
  // ─ Landscape ─────────────────────────────────────────────────────────
  { group: 'Landscape', label: '1920 × 1080  — Banner / Cover (16:9)', value: '1920x1080', width: 1920, height: 1080, apiSize: '1536x1024', geminiRatio: '16:9' },
  { group: 'Landscape', label: '1350 × 1080  — Instagram Landscape (5:4)', value: '1350x1080', width: 1350, height: 1080, apiSize: '1536x1024', geminiRatio: '5:4' },
  // ─ Native ────────────────────────────────────────────────────────────
  { group: 'Native', label: '1024 × 1536  — Native OpenAI (no resize)', value: '1024x1536', width: null, height: null, apiSize: '1024x1536', geminiRatio: '2:3' },
  { group: 'Native', label: 'Native Gemini  — save at AI output size', value: 'gemini-native', width: null, height: null, apiSize: '1024x1536', geminiRatio: '3:4' },
  // ─ Custom ────────────────────────────────────────────────────────────
  { group: 'Custom', label: 'Custom…', value: 'custom', width: null, height: null, apiSize: '1024x1536', geminiRatio: '3:4' },
];

export const DEFAULT_RESOLUTION = '1080x1440';
export const DEFAULT_QUALITY = 'high';

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
export function getGeminiImageSize(quality, model) {
  const isPro = model === 'gemini-3-pro-image';
  if (quality === 'low') return isPro ? '1K' : '0.5K';
  if (quality === 'high') return '4K';
  return '2K'; // medium — best value on both models
}
