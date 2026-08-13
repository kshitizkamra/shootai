const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const target1 = "Edges between model and background must be photo-realistic, not cut-out or sharp-masked. Ignore any background visible in the product reference images.";
const replacement1 = "Edges between model and background must be photo-realistic, not cut-out or sharp-masked. COMPOSITING AND BLENDING: You MUST ground the model in the environment using realistic contact shadows under the feet, ambient occlusion, and floor reflections if applicable. The model must cast a physically accurate shadow onto the ground matching the lighting direction of the background. Use natural depth of field (DoF) to naturally integrate the sharp model into the focal plane. Ignore any background visible in the product reference images.";

s = s.split(target1).join(replacement1);

fs.writeFileSync('src/utils/api.js', s);
console.log('Successfully updated background blending instructions');
