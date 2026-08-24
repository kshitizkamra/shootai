import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("e.event === 'batch_submitted' || e.event === 'realtime_generated'", "e.event === 'batch_submitted' || e.event === 'realtime_generated' || e.event === 'size_predicted'")

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated audit credits")
