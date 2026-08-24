import re

with open('src/components/AdminPanel.js', 'r', encoding='utf-8') as f:
    text = f.read()

# our existing code location:
# {e.detail || '\u2014'}

if "{e.detail || '\\u2014'}" in text:
    new_code = """<div>{e.detail || '\\u2014'}</div>
                      {e.inputUrl && <img src={e.inputUrl} alt="input" style={{height: 60, marginRight: 8, marginTop: 8, borderRadius: 4}} />}
                      {e.outputUrl && <img src={e.outputUrl} alt="output" style={{height: 60, marginTop: 8, borderRadius: 4}} />\"""
    text = text.replace("{e.detail || '\\u2014'}", new_code)

with open('src/components/AdminPanel.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('Patched AdminPanel.js for logging')

