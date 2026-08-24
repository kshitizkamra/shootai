import re

with open('src/utils/api.js', 'r', encoding='utf-8') as f:
    content = f.read()

# We need to change imageSize: getGeminiImageSize(quality || 'medium', model)
# to imageSize: getGeminiImageSize(quality, model, resolution)
# Let's just blindly replace calls to getGeminiImageSize
content = re.sub(
    r"imageSize: getGeminiImageSize\([^,]+,\s*model\)",
    "imageSize: getGeminiImageSize(quality, model, resolution)",
    content
)

# And wait, in callGemini:
# async function callGemini({ images, prompt, quality, resolution }) {
# ...
#   imageSize: getGeminiImageSize(quality || 'high', model),
content = re.sub(
    r"imageSize: getGeminiImageSize\(quality \|\| 'high',\s*model\)",
    "imageSize: getGeminiImageSize(quality, model, resolution)",
    content
)

with open('src/utils/api.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated api.js")
