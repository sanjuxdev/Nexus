import type { PerceptionRegion, OcrToken } from '@contracts/index.js';

export function calculateIoU(box1: [number, number, number, number], box2: [number, number, number, number]): number {
  const [x1, y1, w1, h1] = box1;
  const [x2, y2, w2, h2] = box2;

  const left = Math.max(x1, x2);
  const right = Math.min(x1 + w1, x2 + w2);
  const top = Math.max(y1, y2);
  const bottom = Math.min(y1 + h1, y2 + h2);

  if (left < right && top < bottom) {
    const intersection = (right - left) * (bottom - top);
    const area1 = w1 * h1;
    const area2 = w2 * h2;
    const union = area1 + area2 - intersection;
    return intersection / union;
  }
  return 0;
}

export function performSpatialFusion(domRegions: PerceptionRegion[], visionRegions: PerceptionRegion[], ocrTokens: OcrToken[], iouThreshold: number = 0.5): PerceptionRegion[] {
  const fusedRegions: PerceptionRegion[] = [...domRegions];

  // Merge Vision regions
  for (const vReg of visionRegions) {
    let merged = false;
    for (const fReg of fusedRegions) {
      if (calculateIoU(vReg.bbox, fReg.bbox) >= iouThreshold) {
        // Merge attributes if they overlap significantly
        if (!fReg.source.includes('VISION')) {
           fReg.source.push('VISION');
        }
        if (!fReg.text && vReg.text) {
           fReg.text = vReg.text;
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      fusedRegions.push(vReg);
    }
  }

  // Merge OCR tokens
  for (const ocr of ocrTokens) {
    let merged = false;
    for (const fReg of fusedRegions) {
      if (calculateIoU(ocr.bbox, fReg.bbox) >= iouThreshold) {
        if (!fReg.source.includes('OCR')) {
           fReg.source.push('OCR');
        }
        if (!fReg.text) {
           fReg.text = ocr.text;
        } else if (fReg.text !== ocr.text && !fReg.text.includes(ocr.text)) {
           // Append OCR text if different
           fReg.text += ` ${ocr.text}`;
        }
        merged = true;
        break; // Only merge with the best/first overlapping region
      }
    }
    if (!merged) {
      // If an OCR token doesn't overlap with any interactive region, we might just drop it,
      // or we can add it as a non-interactable region. We will add it as non-interactable.
      fusedRegions.push({
        region_id: `ocr_reg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        local_key: `ocr_fused`,
        dom_ref: null,
        source: ['OCR'],
        semantic_type: 'text',
        text: ocr.text,
        bbox: ocr.bbox,
        confidence: ocr.confidence,
        visible: true,
        interactable: false,
        visual_state: ['visible', 'enabled'],
        route: 'LOW',
        sensitivity: 'none',
        origin: '', // Will be updated by caller
        frame_id: 'main',
        page_state_hash: '', // Will be updated by caller
        timestamp: Date.now(),
      });
    }
  }

  return fusedRegions;
}
