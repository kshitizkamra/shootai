import re

with open('src/components/Workflow.js', 'r', encoding='utf-8') as f:
    text = f.read()

wf_def = """  {
    id: 'G',
    icon: '📏',
    title: 'Size Predictor',
    description: 'Upload front and side photos with a known height to have AI automatically estimate exact physical body measurements.',
    badgeClass: 'badge-a',
  }
];"""

text = re.sub(r'\];\s*(export default function Workflow)', wf_def + r'\n\n\1', text)

with open('src/components/Workflow.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Added to array")
