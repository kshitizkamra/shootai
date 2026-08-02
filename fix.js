const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');
let lines = s.split('\n');

// Fix line 578
lines[577] = lines[577].replace(/\\\\n/g, '\\n');

// Fix line 679
lines[678] = lines[678].replace(/\\\\n/g, '\\n').replace(/\\`/g, '`');

fs.writeFileSync('src/utils/api.js', lines.join('\n'));
console.log('Fixed api.js safely');
