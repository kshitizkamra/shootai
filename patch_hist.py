import os

with open('src/components/History.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("E: 'PDP Shoot E', Batch: 'Batch',", "E: 'PDP Shoot E', G: 'Size Predictor', Batch: 'Batch',")
text = text.replace("E: 'dY\"', Batch: 'dY\"',", "E: 'dY\"', G: '📏', Batch: 'dY\"',")

with open('src/components/History.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated History.js labels")
