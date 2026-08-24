# -*- coding: utf-8 -*-
import sys

with open('src/utils/constants.js', 'r', encoding='utf-8') as f:
    content = f.read()

import re

# Replace RESOLUTION_PRESETS
presets = '''export const RESOLUTION_PRESETS = [
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
];'''

content = re.sub(r'export const RESOLUTION_PRESETS = \[.*?\];', presets, content, flags=re.DOTALL)

content = content.replace("export const DEFAULT_RESOLUTION = '1080x1440';", "export const DEFAULT_RESOLUTION = '1080x1440_1K';")
content = content.replace("export const DEFAULT_QUALITY = 'high';\n", "")

with open('src/utils/constants.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated constants.js")
