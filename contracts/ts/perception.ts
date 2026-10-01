import type { BBox, FrameId, Origin, SemanticType, Source, VisualState } from './common.js';
import type { RoutingLevel } from './router.js';
import type { DomSnapshot } from './dom.js';
import type { CaptureMeta, FaceBox, OcrToken } from './vision.js';

export interface PerceptionRegion {
  region_id: string; // FINAL id "r27" — minted ONLY by M1's assembleFrame()
  local_key: string; // producer's key: dom_id ("d12") or "v3" for vision-only
  source: Source[];
  semantic_type: SemanticType;
  text: string | null; // RAW, local zone only
  bbox: BBox;
  confidence: number;
  confidence_by_source?: Partial<Record<Source, number>>;
  visible: boolean;
  interactable: boolean;
  visual_state?: VisualState[];
  dom_ref: { dom_id: string; role: string | null; tag: string } | null;
  disagreement?: { field: 'state' | 'bbox' | 'type' | 'text'; dom: string; vision: string };
  relations?: { rel: 'above' | 'below' | 'left' | 'right' | 'contains' | 'overlaps' | 'near'; target: string }[];
  route: RoutingLevel;
  sensitivity: 'unclassified' | 'none' | 'pii' | 'secret'; // M3 sets; 'unclassified' at egress ⇒ BLOCK
  origin: Origin;
  frame_id: FrameId;
  page_state_hash: string;
  timestamp: number;
}

export interface PerceptionFrame { // LOCAL ONLY — never serialised to the network
  frame_uid: string;
  cycle_id: string;
  page_state_hash: string;
  origin: Origin;
  regions: PerceptionRegion[];
  ocr_tokens: OcrToken[];
  faces: FaceBox[];
  dom: DomSnapshot;
  capture: CaptureMeta | null;
  ts: number;
}
