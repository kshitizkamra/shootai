const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const oldPose = "POSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.";

const newPose = "POSE — STRICT REPLICATION: You MUST copy the EXACT body stance, posture, and every joint angle from pose reference image ${poseIdx}. If the reference shows hands behind the back, hands in pockets, or a specific leg position, you MUST reproduce it exactly. Do NOT substitute a generic fashion pose (e.g. hand on hip) unless it is explicitly in the reference. Do NOT adapt or change the arm/leg positions. The pose must be a 1:1 match with the reference.";

s = s.split(oldPose).join(newPose);
fs.writeFileSync('src/utils/api.js', s);
console.log('Updated pose prompts in api.js');
