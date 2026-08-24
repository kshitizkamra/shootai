with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("console.log([Shopify VTO] Request received with  product images.);", "console.log([Shopify VTO] Request received with  product images.);")

text = text.replace("const prompt = I am uploading  reference images:", "const prompt = I am uploading  reference images:")

text = text.replace("No text, no overlays, no watermarks.;", "No text, no overlays, no watermarks.;")

text = text.replace("Product reference image : use this for garment details.\\n", "Product reference image : use this for garment details.\\n")

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)
