with open('src/components/GenerationOptions.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("const GROUP_ORDER = ['Portrait', 'Square', 'Landscape', 'Native', 'Custom'];", "const GROUP_ORDER = ['1K (For Batch)', '2K (For High Res)', 'Custom'];")

with open('src/components/GenerationOptions.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated GenerationOptions.js")
