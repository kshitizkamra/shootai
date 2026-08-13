const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const oldPoseLine = "POSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.";

const newPoseLine = "POSE — STRICT 1:1 SKELETON REPLICATION: You MUST perfectly mirror the exact body stance, posture, and every single limb angle from pose reference image ${poseIdx}. CRITICAL: If an arm is hidden behind the back, in a pocket, or straight down in the reference, it MUST be exactly the same in your generation. Do NOT invent visible hands or hands on hips if they are not in the reference. Do NOT adapt the pose to be more 'fashionable'. Copy the exact skeleton.";

s = s.split(oldPoseLine).join(newPoseLine);

fs.writeFileSync('src/utils/api.js', s);
console.log('Successfully updated pose prompt to be extremely strict');
