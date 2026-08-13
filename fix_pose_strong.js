const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const oldPoseLine = "POSE — STRICT REPLICATION: You MUST copy the EXACT body stance, posture, and every joint angle from pose reference image ${poseIdx}. The pose reference image is the ONLY source of truth for the pose. Do NOT copy the pose from the product reference image. If the pose reference shows hands behind the back, hands in pockets, or a specific leg position, you MUST reproduce it exactly. Do NOT substitute a generic fashion pose (e.g. hand on hip). Do NOT adapt or change the arm/leg positions. The pose must be a 1:1 match with the pose reference image.";

const newPoseLine = "POSE — ZERO DEVIATION ALLOWED: You MUST map the model's skeleton EXACTLY to the person/mannequin in pose reference image ${poseIdx}. Mirror every single joint angle, arm position, hip tilt, and leg spacing. If an arm is straight down, generate it straight down. If an arm is behind the back, generate it behind the back. If the legs are together, keep them together. Do NOT default to a fashion pose like 'hand on hip' unless the pose reference image explicitly shows a hand on the hip. The product reference image pose must be IGNORED entirely. The ONLY pose to follow is reference image ${poseIdx}. Your generation will be rejected if the pose does not perfectly overlay the pose reference.";

s = s.split(oldPoseLine).join(newPoseLine);
fs.writeFileSync('src/utils/api.js', s);
console.log('Fixed api.js pose instructions');
