const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const target1 = "Extract only the garment's design, color, print, fabric, and construction. The person in this image is a placeholder mannequin — their face, skin, body, and identity are completely irrelevant and must NEVER appear in the output under any circumstances.";
const repl1 = "Extract only the garment's design, color, print, fabric, and construction. The person or mannequin in this image is a placeholder — their face, skin, body, identity, AND POSE are completely irrelevant. IGNORE THEIR POSE ENTIRELY. Do NOT copy arm or leg positions from this product image.";

s = s.split(target1).join(repl1);

const target2 = "Use this for the garment's construction, silhouette, cut, and structural details ONLY. The fabric, print, and pattern of this garment will be REPLACED — do NOT reproduce the original fabric.";
const repl2 = "Use this for the garment's construction, silhouette, cut, and structural details ONLY. The fabric, print, and pattern of this garment will be REPLACED — do NOT reproduce the original fabric. IGNORE the pose of the person in this image entirely. Do NOT copy their arm or leg positions.";

s = s.split(target2).join(repl2);

const poseLine = "POSE — STRICT REPLICATION: You MUST copy the EXACT body stance, posture, and every joint angle from pose reference image ${poseIdx}. If the reference shows hands behind the back, hands in pockets, or a specific leg position, you MUST reproduce it exactly. Do NOT substitute a generic fashion pose (e.g. hand on hip) unless it is explicitly in the reference. Do NOT adapt or change the arm/leg positions. The pose must be a 1:1 match with the reference.";

const newPoseLine = "POSE — STRICT REPLICATION: You MUST copy the EXACT body stance, posture, and every joint angle from pose reference image ${poseIdx}. The pose reference image is the ONLY source of truth for the pose. Do NOT copy the pose from the product reference image. If the pose reference shows hands behind the back, hands in pockets, or a specific leg position, you MUST reproduce it exactly. Do NOT substitute a generic fashion pose (e.g. hand on hip). Do NOT adapt or change the arm/leg positions. The pose must be a 1:1 match with the pose reference image.";

s = s.split(poseLine).join(newPoseLine);

fs.writeFileSync('src/utils/api.js', s);
console.log('Fixed api.js');
