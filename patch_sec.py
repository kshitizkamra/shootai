import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

anchor = "app.post('/api/shopify/vto', async (req, res) => {"

security_code = """app.post('/api/shopify/vto', async (req, res) => {
  // SECURITY: Prevent unauthorized websites from stealing your API endpoint
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    const isAuthorized = origin.includes('sizyx.com') || 
                         origin.includes('myshopify.com') || 
                         origin.includes('shopifypreview.com') || 
                         origin.includes('localhost');
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized origin. This endpoint is secured for Sizyx.' });
    }
  }
"""

text = text.replace(anchor, security_code)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Added security")
