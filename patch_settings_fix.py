import re

with open('src/components/Settings.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("doSave(qual, res)", "doSave(res)")

ui_block = r'''<div className="form-group">\s*<label className="form-label">Default Quality</label>\s*<select className="form-select" value={quality} onChange={e => handleQualityChange\(e\.target\.value\)}>\s*<option value="high">High.*?<option value="low">Low.*?</select>\s*<p style=\{\{ fontSize: 12, color: 'var\(--gray-500\)', marginTop: 4 \}\}>\s*Can be overridden per-session in each workflow\.\s*</p>\s*</div>'''
content = re.sub(ui_block, "", content, flags=re.DOTALL)

with open('src/components/Settings.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Fixed settings")
