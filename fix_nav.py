import re

with open('src/components/WorkflowSize.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("import TopNav from './TopNav';", "")
old_render = """  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <TopNav onBack={onBack} onNavigate={onNavigate} title="Size Predictor" />"""
new_render = """  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="screen-header">
        <div>
          <button className="back-btn" onClick={onBack}>← Back to Workflows</button>
          <h1>📏 Size Predictor</h1>
          <p>Upload front and side photos with height to automatically predict physical measurements.</p>
        </div>
      </div>"""
text = text.replace(old_render, new_render)

with open('src/components/WorkflowSize.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fixed TopNav error")
