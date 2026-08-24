# -*- coding: utf-8 -*-
import sys
import re

with open('src/utils/constants.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace getResolution to handle new format properly
old_getResolution = r'''export function getResolution\(val\) \{
  const match = RESOLUTION_PRESETS.find\(p => p.value === val\);
  return match \|\| RESOLUTION_PRESETS\[0\];
\}'''

new_getResolution = '''export function getResolution(val) {
  const match = RESOLUTION_PRESETS.find(p => p.value === val);
  return match || RESOLUTION_PRESETS[0];
}'''
content = re.sub(r'export function getResolution\(val\) \{[\s\S]*?\}', new_getResolution, content)

# Modify getGeminiImageSize
new_getGeminiImageSize = '''export function getGeminiImageSize(quality, model, resolutionValue) {
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
}'''
content = re.sub(r'export function getGeminiImageSize\(quality, model\) \{[\s\S]*?\}', new_getGeminiImageSize, content)

with open('src/utils/constants.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated constants.js (2)")
