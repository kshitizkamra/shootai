const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const target1 = "Generate a photorealistic fashion photograph.";
const replacement1 = `Generate a photorealistic fashion photograph.
\${effectivePose ? \`
======================================================================
CRITICAL POSE INSTRUCTION:
You MUST map the generated person's skeleton EXACTLY to the pose reference image \${poseIdx}.
- Mirror the exact arm positions (if an arm is straight down, make it straight down; if it is behind the back, hide it behind the back).
- Mirror the exact leg positions and weight distribution.
- Do NOT invent a generic fashion pose. Do NOT put a hand on the waist unless the reference has a hand on the waist.
- The product reference image pose must be IGNORED entirely.
======================================================================
\` : ''}`;

s = s.split(target1).join(replacement1);
fs.writeFileSync('src/utils/api.js', s);
console.log('Added massive pose block at top of prompt');
