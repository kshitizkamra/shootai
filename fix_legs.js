const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

const target1 = "Do NOT adapt the pose to be more 'fashionable'. Copy the exact skeleton.";
const replacement1 = "Do NOT adapt the pose to be more 'fashionable'. LEGS AND FEET: You MUST maintain the EXACT same space, gap, and distance between the legs as seen in the reference. If the reference's feet are spread apart, the generated feet MUST be spread apart identically. Do NOT bring the legs or knees close together if they are separated in the reference. Copy the exact skeleton 1:1.";

s = s.split(target1).join(replacement1);

fs.writeFileSync('src/utils/api.js', s);
console.log('Successfully updated pose prompt to include strict leg spacing');
