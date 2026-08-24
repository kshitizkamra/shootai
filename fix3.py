import re

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# our existing broken code
if "console.log([Shopify VTO] Request received with  product images.);" in text:
    text = text.replace("console.log([Shopify VTO] Request received with  product images.);", \'console.log(`[Shopify VTO] Request received with ${productImageUrls.length} product images.`);\')

if "console.error([Shopify VTO] Failed to fetch product image , err.message);" in text:
    text = text.replace("console.error([Shopify VTO] Failed to fetch product image , err.message);", \'console.error(`[Shopify VTO] Failed to fetch product image ${url}:`, err.message);\')

if "const prompt = I am uploading  reference images:" in text:
    text = text.replace("const prompt = I am uploading  reference images:", \'const prompt = `I am uploading ${images.length} reference images:\')

if "Product reference image : use this for garment details.\\n" in text:
    text = text.replace("Product reference image : use this for garment details.\\n", \'`product reference image ${i + 2}: use this for garment details.\n`\')

if "No text, no overlays, no watermarks.;" in text:
    text = text.replace("No text, no overlays, no watermarks.;", \"No text, no overlays, no watermarks.`;\")

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('Fixed!')

