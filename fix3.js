const fs = require('fs');
let s = fs.readFileSync('src/utils/api.js', 'utf8');

// Fix the shotType check for Styled Shot
s = s.replace(/shotType === 'Styled'/g, "shotType === 'Styled Shot'");

fs.writeFileSync('src/utils/api.js', s);
console.log('Fixed shotType === Styled Shot check');
