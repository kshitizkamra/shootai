import re

with open('src/components/Workflow.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Add import
if 'WorkflowSize' not in text:
    text = text.replace("import WorkflowF from './WorkflowF';", "import WorkflowF from './WorkflowF';\nimport WorkflowSize from './WorkflowSize';")

wf_def = """  {
    id: 'G',
    icon: '📏',
    title: 'Size Predictor',
    description: 'Upload front and side photos with a known height to have AI automatically estimate exact physical body measurements.',
    badgeClass: 'badge-a',
  }
];"""

text = re.sub(r'\];\s*(export default function Workflow)', wf_def + r'\n\n\1', text)

route = "if (activeWorkflow === 'F') return <WorkflowF onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;\n  if (activeWorkflow === 'G') return <WorkflowSize onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;"
text = text.replace("if (activeWorkflow === 'F') return <WorkflowF onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;", route)

with open('src/components/Workflow.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated Workflow.js")
