const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const target1 = "GARMENT COLOR — BACKGROUND PROOF: Regardless of the background's color temperature, warm or cool ambient tones, or lighting character, the garment's color must remain EXACTLY as shown in the product reference images — do NOT shift, warm, cool, saturate, desaturate, or reinterpret the garment color based on the scene or background in any way.";
const replacement1 = "ENVIRONMENTAL BLENDING AND LIGHTING: Allow natural environmental lighting, ambient color spill, and realistic shadows from the background to fall naturally across the model and garment so they blend perfectly into the scene. Do NOT alter the physical fabric, structure, base hue, or design of the outfit, but DO light it accurately and naturally for the environment it is in.";

const target2 = "GARMENT COLOR — NON-NEGOTIABLE: Do NOT apply background color grading to the garment — the garment's color, hue, and saturation must remain EXACTLY as in the product reference images regardless of background tone. Edges between model and background must be photo-realistic, not cut-out or sharp-masked.";
const replacement2 = "COMPOSITING AND BLENDING: You MUST ground the model in the environment using realistic contact shadows under the feet, ambient occlusion, and floor reflections if applicable. The model must cast a physically accurate shadow onto the ground matching the lighting direction of the background. Use natural depth of field (DoF) to naturally integrate the sharp model into the focal plane. The garment MUST receive natural ambient bounce light from the environment. Edges between model and background must be photo-realistic and seamlessly blended, never cut-out or sharp-masked.";

s = s.split(target1).join(replacement1);
s = s.split(target2).join(replacement2);

fs.writeFileSync('src/utils/api.js', s);
console.log('Successfully updated background blending instructions');
