import os

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("appendAuditLog('Shopify Store', {", "appendAuditLog('shopify_store', {")

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)
