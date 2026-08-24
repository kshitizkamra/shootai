import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

anchor = "app.get('/api/admin/audit', requireAdmin, (req, res) => {"

route_code = """
app.get('/api/admin/shopify-img/:filename', requireAdmin, (req, res) => {
  res.sendFile(path.join(DATA_DIR, 'shopify', req.params.filename));
});

"""

if "app.get('/api/admin/shopify-img/:filename'" not in text:
    text = text.replace(anchor, route_code + anchor)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Added static route")
