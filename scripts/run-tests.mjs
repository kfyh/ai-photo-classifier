import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDir = path.join(__dirname, '../test');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'));

let allPassed = true;

for (const file of files) {
  const fullPath = path.join(testDir, file);
  console.log(`\n--- Running ${file} ---`);
  try {
    const cmd = `npx esbuild "${fullPath}" --bundle --platform=node --external:node:test --external:node:assert | node`;
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    allPassed = false;
    console.error(`Test ${file} failed!`);
  }
}

if (!allPassed) {
  process.exit(1);
}
