import re

with open('src/components/WorkflowSize.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("import { api } from '../utils/api';", "const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';")

old_fetch = """      const res = await api('POST', '/api/gemini-size-prediction', {
        frontImage,
        sideImage,
        heightStr
      });
      
      setResult(res.measurements);"""

new_fetch = """      const token = localStorage.getItem('shootai_token');
      const response = await fetch(${SERVER_URL}/api/gemini-size-prediction, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': Bearer 
        },
        body: JSON.stringify({ frontImage, sideImage, heightStr })
      });
      const res = await response.json();
      if (!response.ok) throw new Error(res.error || 'Prediction failed');
      
      setResult(res.measurements);"""

text = text.replace(old_fetch, new_fetch)

with open('src/components/WorkflowSize.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fixed api import")
