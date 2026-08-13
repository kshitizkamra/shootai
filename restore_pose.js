const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const aggressiveLine = "POSE — ZERO DEVIATION ALLOWED: You MUST map the model's skeleton EXACTLY to the person/mannequin in pose reference image ${poseIdx}. Mirror every single joint angle, arm position, hip tilt, and leg spacing. If an arm is straight down, generate it straight down. If an arm is behind the back, generate it behind the back. If the legs are together, keep them together. Do NOT default to a fashion pose like 'hand on hip' unless the pose reference image explicitly shows a hand on the hip. The product reference image pose must be IGNORED entirely. The ONLY pose to follow is reference image ${poseIdx}. Your generation will be rejected if the pose does not perfectly overlay the pose reference.";

const originalLine = "POSE: Replicate the body stance and posture from pose reference image ${poseIdx} — same arm position, weight distribution, and body language. Adapt this pose naturally to the required camera angle and framing for this shot. Do NOT default to a plain standing pose when a pose reference is provided.";

s = s.split(aggressiveLine).join(originalLine);
fs.writeFileSync('src/utils/api.js', s);
console.log('Restored original friendly pose prompt');
