import type { BBox } from './common.js';
import type { Budget, RoutingPlan } from './router.js';
import type { DomSnapshot } from './dom.js';
import type { PerceptionRegion } from './perception.js';

export interface CaptureMeta {
  capture_id: string;
  page_state_hash: string;
  dpr: number;
  viewport: { w: number; h: number };
  scroll: { x: number; y: number };
  image: { w: number; h: number }; // device pixels
  ts: number;
}

export interface OcrToken {
  text: string;
  bbox: BBox;
  confidence: number;
  line_id: number;
} // bbox in CSS px

export interface FaceBox {
  bbox: BBox;
  confidence: number;
  coordinateSpace: 'frame';
} // CSS px relative to frame

export interface VisionRequest {
  cycle_id: string;
  capture: CaptureMeta;
  image_data_url: string;
  dom: DomSnapshot;
  plan: RoutingPlan;
  mode?: 'proposed' | 'baseline';
}

export interface VisionStats {
  backend: Budget['backend'];
  models: { name: string; version: string }[];
  vision_calls: number;
  ocr_calls: number;
  pixels_processed: number;
  cache_hits: number;
  cache_misses: number;
  escalated: string[];
  timings_ms: Partial<
    Record<
      | 'crop'
      | 'preprocess'
      | 'inference'
      | 'postprocess'
      | 'ocr'
      | 'face'
      | 'ground'
      | 'fuse'
      | 'total',
      number
    >
  >;
}

export interface VisionResult {
  cycle_id: string;
  capture_id: string;
  regions: PerceptionRegion[]; // fused MEDIUM/LOW regions only (HIGH regions come from DOM)
  ocr_tokens: OcrToken[];
  faces: FaceBox[];
  unresolved: { region_key: string; reason: string }[];
  stats: VisionStats;
}
