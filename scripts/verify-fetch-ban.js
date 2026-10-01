import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionSrc = path.resolve(__dirname, '../extension/src');

let violations = 0;

function checkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Exclude network directory where fetch is permitted
      if (entry.name === 'network') continue;
      checkDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      // Match fetch(...) calls
      const fetchMatches = content.match(/\bfetch\s*\(/g);
      if (fetchMatches) {
        console.error(`[VIOLATION I5] fetch() called outside extension/src/network/ in: ${fullPath}`);
        violations += fetchMatches.length;
      }
    }
  }
}

checkDir(extensionSrc);

if (violations > 0) {
  console.error(`FAILED: ${violations} forbidden fetch() call(s) found outside network boundary!`);
  process.exit(1);
} else {
  console.log('✓ Invariant I5 verified: No fetch() calls outside extension/src/network/');
}
