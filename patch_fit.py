import os

with open('server/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_garment = "GARMENT: Reproduce the exact garment from the product reference image(s). EVERY design detail (seams, buttons, zippers, fabric texture), color (hue, saturation, brightness), print pattern (motifs, scale, density), and construction MUST be accurate. The garment must fit the model naturally, following the contours of her true body shape. DO NOT simplify, reinterpret, or alter any design element."
new_garment = """GARMENT: Reproduce the exact garment from the product reference image(s). EVERY design detail (seams, buttons, zippers, fabric texture), color (hue, saturation, brightness), print pattern (motifs, scale, density), and construction MUST be accurate. DO NOT simplify, reinterpret, or alter any design element.
RELATIVE SIZING & FIT: You must analyze how tight or loose the garment is on the original product model. You must dynamically scale the garment's physical size up or down so that it has the EXACT SAME relative fit, drape, and tightness on the customer's unique body size. If the garment is form-fitting on the product model, it must be equally form-fitting on the customer, regardless of the difference in their body sizes."""

text = text.replace(old_garment, new_garment)

with open('server/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Prompt updated successfully.")
