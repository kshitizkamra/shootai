import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# find the success block
anchor = "res.json({ success: true, image: 'data:image/jpeg;base64,' + b64Output });"

log_code = """
    const jobId = Date.now().toString();
    const shopifyDir = path.join(DATA_DIR, 'shopify');
    if (!fs.existsSync(shopifyDir)) fs.mkdirSync(shopifyDir, { recursive: true });
    
    try {
      fs.writeFileSync(path.join(shopifyDir, jobId + '_in.jpg'), customerImageBase64.replace(/^data:image\\/\w+;base64,/, ""), 'base64');
      fs.writeFileSync(path.join(shopifyDir, jobId + '_out.jpg'), b64Output, 'base64');
      
      appendAuditLog('shopify_store', {
        event: 'shopify_vto', 
        detail: 'Generated Virtual Try-On',
        inputUrl: /api/admin/shopify-img/_in.jpg,
        outputUrl: /api/admin/shopify-img/_out.jpg,
        credits: 0
      });
    } catch (logErr) {
      console.error('[Shopify VTO] Failed to save log', logErr.message);
    }
"""

text = text.replace(anchor, log_code + "\n    " + anchor)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Added log code")
