import re
with open('src/utils/api.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_p = r"I am uploading 2 reference images:\n\s*1. Person/model image - use this exact person, their face, body, skin tone and hair\n\s*2. Garment image - dress this person in exactly this garment, every detail preserved\n\s*Generate a photorealistic photograph of the person wearing the garment naturally\.\n\s*\$\{\\(t\.d_core_prompt\\|\\|'The garment should fit naturally on the person\\'s body\.'\\)\} \$\{\\(t\.global\\|\\|\\{\\}\\)\.garment_shape_lock\\|\\|''\} \$\{\\(t\.global\\|\\|\\{\\}\\)\.print_lock_angle\\|\\|''\}\n\s*Keep the person's face, hair, and non-garment features exactly as in reference image 1\.\n\s*Natural indoor or outdoor setting\. Soft flattering lighting\.\n\s*No text, no overlays, no watermarks\."

new_p = r"I am uploading 2 reference images:\n1. MODEL reference - this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone and hair. Reference image 1 is the SOLE source for the model's identity.\n2. GARMENT image - reproduce this exact garment on the model in every detail.\n\nGenerate a photorealistic fashion photograph.\nCHARACTER: exact woman from reference image 1.\n${(t.d_core_prompt||'GARMENT: Reproduce exact garment from reference image 2 - every design detail, color, and construction accurate.')} ${(t.global||"{}).garment_shape_lock||''} ${(t.global||"{}).print_lock_angle||''}\nSETTING: Clean natural setting. The model must look naturally and evenly lit.\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\nPremium D2C fashion brand product photography quality.\nNo text, no overlays, no watermarks."

text = re.sub(old_p, new_p, text)

with open('src/utils/api.js', 'w', encoding='utf-8') as f:
    f.write(text)
print('Done!')
