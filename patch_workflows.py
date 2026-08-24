import os
import glob
import re

for file in glob.glob('src/components/Workflow*.js'):
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Remove quality: 'low',
    content = re.sub(r"quality:\s*'low',\s*", "", content)
    # Remove quality: 'medium',
    content = re.sub(r"quality:\s*'medium',\s*", "", content)
    
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated {file}")

