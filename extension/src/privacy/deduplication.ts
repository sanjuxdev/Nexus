import type { BBox } from '../../contracts/ts/common.js';
import type { PiiDetection } from '../../contracts/ts/privacy.js';

/**
 * PII Detection Deduplication & Overlap Resolution
 * 
 * Prevents oversized redaction boxes caused by:
 * - Duplicate detections from multiple sources (DOM + OCR + Vision)
 * - Overlapping bounding boxes that get merged into one large rectangle
 * - Repeated identifiers appearing multiple times on the page
 * 
 * This module provides spatial deduplication while preserving the distinction
 * between genuinely separate occurrences of the same PII value.
 */

export interface RedactionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  source?: string;
}

/**
 * Calculate Intersection over Union (IoU) between two bounding boxes
 */
export function calculateIoU(bbox1: BBox, bbox2: BBox): number {
  const [x1, y1, w1, h1] = bbox1;
  const [x2, y2, w2, h2] = bbox2;
  
  const left = Math.max(x1, x2);
  const top = Math.max(y1, y2);
  const right = Math.min(x1 + w1, x2 + w2);
  const bottom = Math.min(y1 + h1, y2 + h2);
  
  if (right <= left || bottom <= top) {
    return 0; // No overlap
  }
  
  const intersectionArea = (right - left) * (bottom - top);
  const union = w1 * h1 + w2 * h2 - intersectionArea;
  
  return union > 0 ? intersectionArea / union : 0;
}

/**
 * Check if two bounding boxes significantly overlap (IoU > threshold)
 */
export function boxesOverlap(bbox1: BBox, bbox2: BBox, iouThreshold = 0.7): boolean {
  return calculateIoU(bbox1, bbox2) >= iouThreshold;
}

/**
 * Deduplicate PII detections by merging those with highly overlapping bounding boxes.
 * 
 * Strategy:
 * - Keep the detection with highest confidence
 * - Preserve distinct source attribution
 * - Use tight bounding box (don't expand unnecessarily)
 * 
 * @param detections - Raw detections from all sources
 * @param iouThreshold - Overlap threshold (0.7 = 70% overlap triggers merge)
 * @returns Deduplicated detections
 */
export function deduplicateDetections(
  detections: PiiDetection[],
  iouThreshold = 0.7
): PiiDetection[] {
  if (detections.length === 0) return [];
  
  const deduplicated: PiiDetection[] = [];
  const processed = new Set<number>();
  
  for (let i = 0; i < detections.length; i++) {
    if (processed.has(i)) continue;
    
    const current = detections[i]!;
    if (!current.bbox) {
      deduplicated.push(current);
      processed.add(i);
      continue;
    }
    
    // Find all detections that overlap with this one
    const overlapping: number[] = [i];
    
    for (let j = i + 1; j < detections.length; j++) {
      if (processed.has(j)) continue;
      
      const other = detections[j]!;
      if (!other.bbox) continue;
      
      // Check if they overlap spatially AND refer to the same PII type
      if (current.type === other.type && boxesOverlap(current.bbox, other.bbox, iouThreshold)) {
        overlapping.push(j);
      }
    }
    
    if (overlapping.length === 1) {
      // No overlap, keep as is
      deduplicated.push(current);
      processed.add(i);
    } else {
      // Merge overlapping detections
      const group = overlapping.map(idx => detections[idx]!);
      
      // Keep detection with highest confidence
      const best = group.reduce((prev, curr) => 
        curr.confidence > prev.confidence ? curr : prev
      );
      
      // Merge sources from all detections
      const allSources = new Set(group.flatMap(d => d.source));
      
      // Use the tightest bounding box (smallest area that still covers the field)
      const tightestBox = group.reduce((smallest, curr) => {
        const smallestArea = smallest.bbox![2] * smallest.bbox![3];
        const currArea = curr.bbox![2] * curr.bbox![3];
        return currArea < smallestArea ? curr : smallest;
      });
      
      deduplicated.push({
        ...best,
        source: Array.from(allSources) as any,
        bbox: tightestBox.bbox,
      });
      
      overlapping.forEach(idx => processed.add(idx));
    }
  }
  
  return deduplicated;
}

/**
 * Deduplicate redaction boxes with spatial overlap awareness.
 * 
 * Unlike detection deduplication, this operates on final redaction boxes
 * and focuses on preventing visual overlap in the masked output.
 * 
 * @param boxes - Redaction boxes to deduplicate
 * @param iouThreshold - Overlap threshold
 * @returns Deduplicated boxes
 */
export function deduplicateRedactionBoxes(
  boxes: RedactionBox[],
  iouThreshold = 0.7
): RedactionBox[] {
  if (boxes.length === 0) return [];
  
  const deduplicated: RedactionBox[] = [];
  const processed = new Set<number>();
  
  for (let i = 0; i < boxes.length; i++) {
    if (processed.has(i)) continue;
    
    const current = boxes[i]!;
    const currentBbox: BBox = [current.x, current.y, current.w, current.h];
    
    // Find overlapping boxes
    const overlapping: number[] = [i];
    
    for (let j = i + 1; j < boxes.length; j++) {
      if (processed.has(j)) continue;
      
      const other = boxes[j]!;
      const otherBbox: BBox = [other.x, other.y, other.w, other.h];
      
      if (boxesOverlap(currentBbox, otherBbox, iouThreshold)) {
        overlapping.push(j);
      }
    }
    
    if (overlapping.length === 1) {
      deduplicated.push(current);
      processed.add(i);
    } else {
      // Merge overlapping boxes - use the SMALLEST box that fully covers the PII
      // (not the union, which would create oversized redactions)
      const group = overlapping.map(idx => boxes[idx]!);
      const smallest = group.reduce((prev, curr) => {
        const prevArea = prev.w * prev.h;
        const currArea = curr.w * curr.h;
        return currArea < prevArea ? curr : prev;
      });
      
      deduplicated.push(smallest);
      overlapping.forEach(idx => processed.add(idx));
    }
  }
  
  return deduplicated;
}

/**
 * Filter out redaction boxes that are unreasonably large.
 * 
 * Prevents entire page sections from being blacked out when only a small
 * field should be masked (e.g., PAN number in a Google Images thumbnail).
 * 
 * @param boxes - Redaction boxes
 * @param maxWidth - Maximum acceptable width (px)
 * @param maxHeight - Maximum acceptable height (px)
 * @param viewport - Viewport dimensions for percentage-based limits
 * @returns Filtered boxes
 */
export function filterOversizedBoxes(
  boxes: RedactionBox[],
  maxWidth = 800,
  maxHeight = 600,
  viewport?: { w: number; h: number }
): RedactionBox[] {
  return boxes.filter((box) => {
    // Absolute size check
    if (box.w > maxWidth || box.h > maxHeight) {
      console.warn(
        `[Deduplication] Filtering oversized box: ${box.w}x${box.h} (label: ${box.label})`
      );
      return false;
    }
    
    // Percentage check: Don't mask more than 60% of viewport width/height
    if (viewport) {
      const widthPercent = box.w / viewport.w;
      const heightPercent = box.h / viewport.h;
      
      if (widthPercent > 0.6 || heightPercent > 0.6) {
        console.warn(
          `[Deduplication] Filtering box covering ${(widthPercent * 100).toFixed(0)}% width, ${(heightPercent * 100).toFixed(0)}% height`
        );
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Split a large detection region into smaller sub-regions based on spatial clustering
 * of child elements or OCR tokens.
 * 
 * Example: A Google Images thumbnail region containing multiple small PII occurrences
 * should be split into individual precise boxes rather than one large blackout.
 * 
 * @param largeBox - The oversized box to subdivide
 * @param childBboxes - Smaller bounding boxes within the large region
 * @returns Array of precise sub-regions
 */
export function subdivideOversizedRegion(
  largeBox: BBox,
  childBboxes: BBox[]
): BBox[] {
  if (childBboxes.length === 0) {
    return [largeBox];
  }
  
  // Filter children that actually fall within the large box
  const [lx, ly, lw, lh] = largeBox;
  const contained = childBboxes.filter(([cx, cy, cw, ch]) =>
    cx >= lx && cy >= ly && cx + cw <= lx + lw && cy + ch <= ly + lh
  );
  
  if (contained.length === 0) {
    return [largeBox];
  }
  
  // Return the contained child boxes as precise subdivisions
  return contained;
}
