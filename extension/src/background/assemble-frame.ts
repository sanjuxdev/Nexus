import type {
  CaptureMeta,
  DomSnapshot,
  PerceptionFrame,
  PerceptionRegion,
  RegionIndexEntry,
  RoutingPlan,
  VisionResult,
} from '@contracts/index.js';
import { domElementToPerceptionRegion } from '../perception/dom/to-regions.js';


function getIntersectionArea(b1: [number, number, number, number], b2: [number, number, number, number]): number {
  const xLeft = Math.max(b1[0], b2[0]);
  const yTop = Math.max(b1[1], b2[1]);
  const xRight = Math.min(b1[0] + b1[2], b2[0] + b2[2]);
  const yBottom = Math.min(b1[1] + b1[3], b2[1] + b2[3]);
  if (xRight < xLeft || yBottom < yTop) return 0;
  return (xRight - xLeft) * (yBottom - yTop);
}

export interface AssemblyResult {
  frame: PerceptionFrame;
  regionIndex: Record<string, RegionIndexEntry>;
  registryMapping: Record<string, string>; // region_id -> dom_id
}

export function assembleFrame(
  cycleId: string,
  domSnapshot: DomSnapshot,
  routingPlan: RoutingPlan,
  visionResult: VisionResult | null,
  captureMeta: CaptureMeta | null
): AssemblyResult {
  const domIdsToInclude = new Set(
    routingPlan.decisions
      .filter((d) => d.level === 'HIGH' || d.level === 'MEDIUM')
      .map((d) => d.dom_id)
  );

  const candidateRegions: PerceptionRegion[] = [];

  // 1. High and Medium-confidence DOM elements
  for (const el of domSnapshot.elements) {
    if (domIdsToInclude.has(el.dom_id) && el.visible) {
      candidateRegions.push(domElementToPerceptionRegion(el, domSnapshot));
    }
  }

  // 2. Fused Medium/Low regions from VisionResult (IoU Spatial Fusion)
  if (visionResult && visionResult.regions) {
    for (const vReg of visionResult.regions) {
      let isDuplicate = false;
      
      const vArea = vReg.bbox[2] * vReg.bbox[3];
      if (vArea <= 0) continue;

      // Phase 5 Spatial Fusion: Prevent merging into massive parent containers
      for (const dReg of candidateRegions) {
        if (!dReg.bbox || !vReg.bbox) continue;
        const dArea = dReg.bbox[2] * dReg.bbox[3];
        if (dArea <= 0) continue;

        const intersection = getIntersectionArea(dReg.bbox, vReg.bbox);
        
        const iou = intersection / (dArea + vArea - intersection);
        const iom = intersection / Math.min(dArea, vArea);
        const areaRatio = Math.max(dArea, vArea) / Math.min(dArea, vArea);

        // Agreement: Highly overlapping and roughly the same size
        const isAgreement = iou > 0.5;
        // Containment: Vision is inside DOM, but DOM is not massively larger (prevent enlarging sensitive regions)
        const isSafeContainment = iom > 0.8 && areaRatio < 4.0;

        if (isAgreement || isSafeContainment) {
          isDuplicate = true;
          // Merge text if DOM region lacked it, or append it if they disagree
          if (vReg.text) {
            if (!dReg.text) {
              dReg.text = vReg.text;
            } else if (!dReg.text.includes(vReg.text)) {
              dReg.text += ' ' + vReg.text;
            }
          }
          
          // Combine confidences (take the max)
          dReg.confidence = Math.max(dReg.confidence || 0, vReg.confidence || 0);

          // Mark the DOM region as having an OCR/Vision source match
          if (vReg.source) {
            dReg.source = dReg.source || [];
            for (const s of vReg.source) {
              if (!dReg.source.includes(s)) dReg.source.push(s);
            }
          }
          break;
        }
      }
      
      // Only push if it is a truly novel visual element (Disagreement / Independent Vision region)
      if (!isDuplicate) {
        candidateRegions.push(vReg);
      }
    }
  }

  // 2b. Map Faces into Unified Regions
  if (visionResult && visionResult.faces) {
    visionResult.faces.forEach((face, idx) => {
      candidateRegions.push({
        region_id: (face as any).face_id || `face_${idx}`,
        local_key: (face as any).face_id || `face_${idx}`,
        dom_ref: null,
        source: ['VISION'],
        semantic_type: 'image', // Marked as image to allow redaction, wait, privacy.stub.ts looks for 'FACE' type in detections
        // We will pass it as a regular region but we need it to trigger redaction.
        text: '<<FACE_DETECTED>>', // Artificial text signal so regex or pipeline triggers if needed, but wait, privacy.stub.ts looks at req.frame.faces!
        bbox: face.bbox,
        confidence: face.confidence,
        visible: true,
        interactable: false,
        visual_state: ['visible', 'enabled'],
        route: 'LOW',
        sensitivity: 'pii',
        origin: domSnapshot.url_origin,
        frame_id: 'main',
        page_state_hash: domSnapshot.page_state_hash,
        timestamp: Date.now(),
      });
    });
  }

  // 3. Sort regions strictly by reading order (y bucketed, then x) for deterministic region_id minting (Invariant I2)
  candidateRegions.sort((a, b) => {
    const lineA = Math.floor(a.bbox[1] / 16);
    const lineB = Math.floor(b.bbox[1] / 16);
    if (lineA !== lineB) {
      return lineA - lineB;
    }
    return a.bbox[0] - b.bbox[0];
  });

  // 4. Mint region_ids: r1, r2, ...
  const finalRegions: PerceptionRegion[] = [];
  const regionIndex: Record<string, RegionIndexEntry> = {};
  const registryMapping: Record<string, string> = {};

  let counter = 1;
  for (const reg of candidateRegions) {
    const regionId = `r${counter++}`;
    reg.region_id = regionId;

    finalRegions.push(reg);

    const domId = reg.dom_ref?.dom_id || (reg.local_key.startsWith('d') ? reg.local_key : null);
    if (domId) {
      registryMapping[regionId] = domId;
    }

    regionIndex[regionId] = {
      frame_id: reg.frame_id,
      origin: reg.origin,
      dom_id: domId,
      local_key: reg.local_key,
      bbox: reg.bbox,
      semantic_type: reg.semantic_type,
      interactable: reg.interactable,
      injection_suspected: false,
    };
  }

  const frame: PerceptionFrame = {
    frame_uid: `frm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    cycle_id: cycleId,
    page_state_hash: domSnapshot.page_state_hash,
    origin: domSnapshot.url_origin,
    regions: finalRegions,
    ocr_tokens: visionResult?.ocr_tokens || [],
    faces: visionResult?.faces || [],
    dom: domSnapshot,
    capture: captureMeta,
    ts: Date.now(),
  };

  return {
    frame,
    regionIndex,
    registryMapping,
  };
}
