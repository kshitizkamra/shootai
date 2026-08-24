import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# our existing code location:
if "console.log('[Shopify VTO] Success!');" in text:
    logging_code = """
    console.log('[Shopify VTO] Success!');
    
    // Log to history and save images to disk
    const jobId = Date.now().toString();
    const shopifyDir = path.join(DATA_DIR, 'shopify');
    if (!fs.existsSync(shopifyDir)) fs.mkdirSync(shopifyDir, { recursive: true });
    
    try {
      fs.writeFileSync(path.join(shopifyDir, `${jobId}_in.jpg`), customerImageBase64.replace(/^data:image\\/\w+;base64,/, ""), 'base64');
      fs.writeFileSync(path.join(shopifyDir, `${jobId}_out.jpg`), b64Output, 'base64');
      
      appendAuditLog('Shopify Store', {
        event: 'shopify_vto', 
        detail: 'Generated Virtual Try-On',
        inputUrl: `/api/admin/shopify-img/${jobId}_in.jpg`,
        outputUrl: `/api/admin/shopify-img/${jobId}_out.jpg`,
        credits: 0
      });
    } catch (logErr) {
      console.error('[Shopify VTO] Failed to save log2', logErr.message);
    }
    """
    text = text.replace("console.log('[Shopify VTO] Success!');", logging_code)

# add static route for shopify images
if "app.get('/api/admin/audit'" in text:
    route_code = """app.get('/api/admin/shopify-img/:filename', requireAdmin, (req, res) => {
  res.sendFile(path.join(DATA_DIR, 'shopify', req.params.filename));
});

app.get('/api/admin/audit'"""
    text = text.replace("app.get('/api/admin/audit'", route_code)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('Patched server.js for logging')

