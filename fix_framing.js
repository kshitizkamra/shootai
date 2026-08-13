const fs = require('fs');
const filePath = 'src/utils/api.js';
let s = fs.readFileSync(filePath, 'utf8');

const target = "COMPOSITING AND BLENDING: You MUST ground the model in the environment using realistic contact shadows under the feet, ambient occlusion, and floor reflections if applicable. The model must cast a physically accurate shadow onto the ground matching the lighting direction of the background. Use natural depth of field (DoF) to naturally integrate the sharp model into the focal plane. The garment MUST receive natural ambient bounce light from the environment. Edges between model and background must be photo-realistic and seamlessly blended, never cut-out or sharp-masked.";
const replacement = "COMPOSITING AND BLENDING: You MUST ground the model in the environment using realistic contact shadows under the feet, ambient occlusion, and floor reflections if applicable. The model must cast a physically accurate shadow onto the ground matching the lighting direction of the background. Use natural depth of field (DoF) to naturally integrate the sharp model into the focal plane. The garment MUST receive natural ambient bounce light from the environment. Edges between model and background must be photo-realistic and seamlessly blended, never cut-out or sharp-masked. DYNAMIC FRAMING: If the background contains furniture, plants, or architectural details, scale the model proportionally to the room (occupying roughly 70% of the frame) so she looks like a realistic human next to the props. If the background is a plain solid color, keep the model full-size, filling the entire vertical frame.";

s = s.split(target).join(replacement);

fs.writeFileSync(filePath, s);
console.log('Successfully added DYNAMIC FRAMING instruction');
