
const fs = require("fs");
let content = fs.readFileSync("src/utils/api.js", "utf8");

content = content.replace(
  /const prompt = `I am uploading 2 reference images:[\s\S]*?No text, no overlays, no watermarks.`;/g,
  `const prompt = \`I am uploading 2 reference images:\\n1. MODEL reference - this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone and hair. Reference image 1 is the SOLE source for the model's identity.\\n2. GARMENT image - reproduce this exact garment on the model in every detail.\\n\\nGenerate a photorealistic fashion photograph.\\nCHARACTER: exact woman from reference image 1.\\n${(t.d_core_prompt||'GARMENT: Reproduce exact garment from reference image 2 - every design detail, color, and construction accurate.')} ${(t.global||{}).garment_shape_lock||''} ${(t.global||{}).print_lock_angle||''}\\nSETTING: Clean natural setting. The model must look naturally and evenly lit.\\nAction: standing naturally, arms relaxed, looking slightly off camera. Full body head to toe.\\nPremium D2C fashion brand product photography quality.\\nNo text, no overlays, no watermarks.\`;`
);

fs.writeFileSync("src/utils/api.js", content, "utf8");
console.log("Fixed api.js");

