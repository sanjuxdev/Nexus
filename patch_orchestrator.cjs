const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'extension/src/background/orchestrator.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Ensure we add the import at the top
if (!content.includes('perceptionDaemon')) {
  content = content.replace(
    "import { ensureOffscreen } from './offscreen.js';",
    "import { ensureOffscreen } from './offscreen.js';\nimport { perceptionDaemon } from './perception-daemon.js';"
  );
}

const startMarker = "      // ----------------------------------------------------\n      // 1. PERCEIVING (DOM / ARIA)";
const endMarker = "      // ----------------------------------------------------\n      // 6. PLANNING";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found!');
  process.exit(1);
}

const replacement = `      // ----------------------------------------------------
      // 1-5. PERCEIVING & SANITIZING (DECOUPLED DAEMON)
      // ----------------------------------------------------
      const cycleReq = {
        cycleId,
        session,
        activeAbortController,
        broadcastUiState,
      };

      const perceptionResult = await perceptionDaemon.runCycle(cycleReq);
      
      if (!perceptionResult) {
        break; // Aborted or null
      }

      if (perceptionResult.isBlocked) {
        break;
      }
      
      if (perceptionResult.needsReperceive) {
        session.state = 'REPERCEIVE';
        broadcastUiState({ state: 'REPERCEIVE' });
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      const { domSnapshot, sanRes, captureMeta } = perceptionResult;

`;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync(filePath, newContent);
console.log('Successfully patched orchestrator.ts');
