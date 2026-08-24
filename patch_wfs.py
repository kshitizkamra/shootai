import os

with open('src/components/WorkflowSize.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("type: 'size_predicted',", "type: 'size_predicted',\n          workflow: 'G',\n          label: 'Size Prediction: ' + heightStr,")

with open('src/components/WorkflowSize.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated WorkflowSize.js history")
