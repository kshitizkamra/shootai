import re

with open('src/components/Workflow.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("if (activeWorkflow === 'G') return <WorkflowSize onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;\n  if (activeWorkflow === 'G') return <WorkflowSize onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;", "if (activeWorkflow === 'G') return <WorkflowSize onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;")

with open('src/components/Workflow.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fixed duplicate")
