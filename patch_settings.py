import re

with open('src/components/Settings.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Update GROUP_ORDER
content = content.replace("const GROUP_ORDER = ['Portrait', 'Square', 'Landscape', 'Native', 'Custom'];", "const GROUP_ORDER = ['1K (For Batch)', '2K (For High Res)', 'Custom'];")

# Remove quality state
content = re.sub(r"const \[quality, setQuality\] = useState\([^)]*\);\n\s*", "", content)

# Update loadSettings
content = re.sub(r"setQuality\(s\.defaultQuality \|\| '[^']*'\);\n\s*", "", content)

# Change default resolution reading
content = content.replace("const res = s.defaultResolution || '1080x1440';", "const res = s.defaultResolution || '1080x1440_1K';")

# Remove handleQualityChange
content = re.sub(r"function handleQualityChange[^}]*\}\n", "", content)

# Update scheduleAutoSave signatures
content = re.sub(r"scheduleAutoSave\(quality, encoded\);", "scheduleAutoSave(encoded);", content)
content = re.sub(r"scheduleAutoSave\(quality, val\);", "scheduleAutoSave(val);", content)
content = re.sub(r"function scheduleAutoSave\(qual, res\)", "function scheduleAutoSave(res)", content)
content = re.sub(r"await saveSettings\(\{ defaultQuality: qual, defaultResolution: res \|\| resolution \}\);", "await saveSettings({ defaultResolution: res || resolution });", content)

# Update doSave signatures
content = re.sub(r"await doSave\(quality, resolution\);", "await doSave(resolution);", content)
content = re.sub(r"async function doSave\(qual, res\)", "async function doSave(res)", content)
content = re.sub(r"await saveSettings\(\{ defaultQuality: qual, defaultResolution: res \}\);", "await saveSettings({ defaultResolution: res });", content)

# Remove Quality UI block
ui_block = r'''<div className="col-md-6 mb-3">
              <label className="form-label">Default Quality</label>
              <select className="form-select" value={quality} onChange={e => handleQualityChange\(e.target.value\)}>
                <option value="low">Low \(0.5K / 1K\) - Best for fast batching</option>
                <option value="medium">Medium \(2K\) - Best value & quality</option>
                <option value="high">High \(4K\) - Print quality \(slow\)</option>
              </select>
            </div>'''
content = re.sub(ui_block, "", content, flags=re.DOTALL)

with open('src/components/Settings.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated Settings.js")
