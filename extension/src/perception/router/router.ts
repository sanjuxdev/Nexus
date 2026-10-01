import type {
  BBox,
  Budget,
  DirtyEvent,
  DomSnapshot,
  PerceptionFrame,
  RoutingDecision,
  RoutingLevel,
  RoutingPlan,
  VisionTask,
} from '@contracts/index.js';
import { padBBox } from '@contracts/geometry.js';
import { ROUTER_THRESHOLDS } from './rules.js';
import { scoreDomElement } from './scoring.js';
import { findCoverageGaps } from './gaps.js';

export function route(
  snap: DomSnapshot,
  _prev: PerceptionFrame | null,
  dirty: DirtyEvent[],
  budget: Budget,
  options?: { enableCoverageGaps?: boolean }
): RoutingPlan {
  const decisions: RoutingDecision[] = [];
  let visionRegionCount = 0;

  for (const el of snap.elements) {
    const { score, reasons, forceLow, forceAtLeastMedium } = scoreDomElement(el);

    // Check if element intersects any dirty bounding box
    const isDirty = dirty.some(
      (d) =>
        d.frame_id === el.frame_id &&
        (!d.bbox ||
          (el.bbox[0] < d.bbox[0] + d.bbox[2] &&
            el.bbox[0] + el.bbox[2] > d.bbox[0] &&
            el.bbox[1] < d.bbox[1] + d.bbox[3] &&
            el.bbox[1] + el.bbox[3] > d.bbox[1]))
    );

    if (isDirty) {
      reasons.push('dirty_region_mutation');
    }

    let level: RoutingLevel;
    if (forceLow) {
      level = 'LOW';
    } else if (score >= ROUTER_THRESHOLDS.TAU_HIGH && !forceAtLeastMedium && !isDirty) {
      level = 'HIGH';
    } else if (score >= ROUTER_THRESHOLDS.TAU_LOW || forceAtLeastMedium || isDirty) {
      level = 'MEDIUM';
    } else {
      level = 'LOW';
    }

    let needs: VisionTask[] = [];
    if (level === 'HIGH') {
      needs = [];
    } else if (level === 'MEDIUM') {
      needs = forceAtLeastMedium ? ['ocr', 'face', 'ground'] : ['ocr', 'ground'];
    } else {
      needs = ['ui_detect', 'ocr', 'face', 'ground'];
    }

    let crop: BBox | null = padBBox(el.bbox, ROUTER_THRESHOLDS.CROP_PADDING_PX, snap.viewport);

    // Respect budget constraint
    if (level !== 'HIGH') {
      if (visionRegionCount >= budget.max_vision_regions) {
        reasons.push('budget_capped');
        needs = [];
        crop = null;
      } else {
        visionRegionCount++;
      }
    } else {
      crop = null;
    }

    decisions.push({
      region_key: el.dom_id,
      dom_id: el.dom_id,
      level,
      reasons,
      crop,
      needs,
    });
  }

  // Optional Phase 3: Coverage gaps for uncovered visual regions (only when enabled and budget allows)
  if (options?.enableCoverageGaps && visionRegionCount < budget.max_vision_regions) {
    const coveredBoxes = snap.elements
      .filter((e) => e.visible)
      .map((e) => e.bbox);
    const gaps = findCoverageGaps(snap.viewport, coveredBoxes);

    for (const gap of gaps) {
      if (visionRegionCount < budget.max_vision_regions) {
        decisions.push(gap);
        visionRegionCount++;
      }
    }
  }

  const needs_screenshot = decisions.some((d) => d.needs.length > 0);

  return {
    snapshot_id: snap.snapshot_id,
    page_state_hash: snap.page_state_hash,
    decisions,
    needs_screenshot,
    budget,
  };
}
