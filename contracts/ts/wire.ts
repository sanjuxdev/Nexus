import type { BBox, FrameId, Origin, SemanticType, Source, VisualState } from './common.js';
import type { CapabilityDescriptor, PiiType, StepSummary } from './privacy.js';

export interface SanitizedRegion {
  region_id: string;
  type: SemanticType;
  text: string | null; // placeholders like <EMAIL> already applied
  bbox: BBox;
  state: VisualState[];
  interactable: boolean;
  frame_id: FrameId;
  sources: Source[];
  confidence: number;
  relations?: { rel: string; target: string }[];
  trust: 'untrusted'; // ALWAYS — page-derived
}

export interface SanitizedContext {
  schema_version: '1.0';
  request_id: string;
  task_id: string;
  step_index: number;
  task: string; // TRUSTED intent (sanitized)
  page: {
    origin: Origin;
    path: string;
    title: string | null;
    page_state_hash: string;
    viewport: { w: number; h: number };
    frame_ids: FrameId[];
  };
  regions: SanitizedRegion[]; // UNTRUSTED page-derived data
  capabilities: CapabilityDescriptor[];
  redactions: { type: PiiType; count: number }[];
  image: null | {
    mime: 'image/jpeg';
    data_base64: string;
    width: number;
    height: number;
    covers_region_ids: string[];
  };
  history: StepSummary[];
  flags: { injection_suspected_region_ids: string[] };
}
