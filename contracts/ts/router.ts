import type { BBox } from './common.js';

export type RoutingLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type VisionTask = 'ocr' | 'ui_detect' | 'face' | 'ground';
export type BudgetLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Budget {
  level: BudgetLevel;
  backend: 'webgpu' | 'webgl' | 'wasm' | 'none';
  max_vision_regions: number;
  max_pixels: number;
  allow_detector: boolean;
  ocr_mode: 'off' | 'fast' | 'high_recall';
}

export interface RoutingDecision {
  region_key: string; // dom_id, or "gap:<n>" for uncovered visual areas
  dom_id: string | null;
  level: RoutingLevel;
  reasons: string[]; // explainable telemetry: "rendering=canvas", "no accessible name" ...
  crop: BBox | null; // targeted region for MEDIUM/LOW
  needs: VisionTask[];
}

export interface RoutingPlan {
  snapshot_id: string;
  page_state_hash: string;
  decisions: RoutingDecision[];
  needs_screenshot: boolean;
  budget: Budget;
}
