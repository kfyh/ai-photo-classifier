const fs = require('fs');
const path = require('path');
const jiti = require('jiti')(__filename, {
  esmResolve: true,
  interopDefault: true,
});

const testDir = path.join(__dirname, '../test');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'));

for (const file of files) {
  const fullPath = path.join(testDir, file);
  jiti(fullPath);
}
