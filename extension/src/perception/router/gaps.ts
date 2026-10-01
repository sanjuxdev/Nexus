import type { BBox, RoutingDecision } from '@contracts/index.js';

export function findCoverageGaps(
  viewport: { w: number; h: number },
  coveredBBoxes: BBox[],
  gridSize = 128
): RoutingDecision[] {
  const cols = Math.ceil(viewport.w / gridSize);
  const rows = Math.ceil(viewport.h / gridSize);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(false));

  // Mark covered cells
  for (const [bx, by, bw, bh] of coveredBBoxes) {
    const cStart = Math.max(0, Math.floor(bx / gridSize));
    const cEnd = Math.min(cols - 1, Math.floor((bx + bw) / gridSize));
    const rStart = Math.max(0, Math.floor(by / gridSize));
    const rEnd = Math.min(rows - 1, Math.floor((by + bh) / gridSize));

    for (let r = rStart; r <= rEnd; r++) {
      for (let c = cStart; c <= cEnd; c++) {
        grid[r]![c] = true;
      }
    }
  }

  const gapDecisions: RoutingDecision[] = [];
  let gapId = 1;

  // Simple scan for consecutive 2x2 uncovered blocks
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!grid[r]![c] && !grid[r]![c + 1] && !grid[r + 1]![c] && !grid[r + 1]![c + 1]) {
        // Mark used
        grid[r]![c] = true;
        grid[r]![c + 1] = true;
        grid[r + 1]![c] = true;
        grid[r + 1]![c + 1] = true;

        const x = c * gridSize;
        const y = r * gridSize;
        const w = Math.min(viewport.w - x, gridSize * 2);
        const h = Math.min(viewport.h - y, gridSize * 2);

        gapDecisions.push({
          region_key: `gap:${gapId++}`,
          dom_id: null,
          level: 'LOW',
          reasons: ['unexplained_viewport_area'],
          crop: [x, y, w, h],
          needs: ['ui_detect', 'ocr', 'face', 'ground'],
        });
      }
    }
  }

  return gapDecisions;
}
