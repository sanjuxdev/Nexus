import type { DomElementInfo } from '@contracts/index.js';
import { ROUTER_THRESHOLDS } from './rules.js';

export interface ScoreResult {
  score: number;
  reasons: string[];
  forceLow: boolean;
  forceAtLeastMedium: boolean;
}

export function scoreDomElement(el: DomElementInfo): ScoreResult {
  const reasons: string[] = [];
  let score = 0;
  let forceLow = false;
  let forceAtLeastMedium = false;

  const area = el.bbox[2] * el.bbox[3];

  // Hard rules for LOW
  if (el.rendering === 'canvas') {
    reasons.push('rendering=canvas');
    forceLow = true;
  } else if (el.rendering === 'shadow_closed') {
    reasons.push('rendering=shadow_closed');
    forceLow = true;
  }

  // Visual PII coverage rule (Invariant I6)
  if (
    (el.rendering === 'img' ||
      el.rendering === 'video' ||
      el.rendering === 'canvas' ||
      el.rendering === 'svg' ||
      el.has_bg_image) &&
    area >= ROUTER_THRESHOLDS.MIN_IMAGE_AREA_FOR_SCAN
  ) {
    reasons.push('visual_media_area_threshold');
    forceAtLeastMedium = true;
  }

  if (forceLow) {
    return { score: 0.1, reasons, forceLow, forceAtLeastMedium };
  }

  // Feature scoring
  if (el.role) {
    score += 0.25;
    reasons.push(`has_role(${el.role})`);
  } else {
    reasons.push('missing_role');
  }

  if (el.name && el.name.length > 0) {
    score += 0.35;
    reasons.push(`has_acc_name`);
  } else {
    reasons.push('missing_acc_name');
  }

  if (el.visible) {
    score += 0.15;
  } else {
    score -= 0.2;
    reasons.push('not_visible');
  }

  if (el.bbox[2] > 0 && el.bbox[3] > 0) {
    score += 0.15;
  }

  if (el.rendering === 'html') {
    score += 0.1;
  }

  if (el.handlers_hint && (!el.role || !el.name)) {
    score -= 0.3;
    reasons.push('click_handler_without_semantics');
  }

  if (el.occluded) {
    score -= 0.25;
    reasons.push('occluded');
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    reasons,
    forceLow,
    forceAtLeastMedium,
  };
}
