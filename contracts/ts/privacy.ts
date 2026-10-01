import type { BBox, Origin } from './common.js';
import type { ActionType } from './action.js';
import type { PerceptionFrame } from './perception.js';

export type PiiType =
  | 'EMAIL'
  | 'PHONE'
  | 'PERSON'
  | 'ADDRESS'
  | 'DOB'
  | 'CARD'
  | 'PASSWORD'
  | 'AUTH_TOKEN'
  | 'GOV_ID'
  | 'BANK_ACCOUNT'
  | 'FACE'
  | 'IDENTIFIER';

export interface PiiDetection { // never stores the raw value
  id: string;
  type: PiiType;
  source: ('DOM' | 'REGEX' | 'OCR' | 'VISION' | 'VAULT' | 'CONTEXT')[];
  region_id: string | null;
  bbox: BBox | null;
  span: [number, number] | null;
  confidence: number;
  mandatory: boolean;
}

export interface StepSummary {
  step: number;
  action: ActionType;
  target_region_id: string | null;
  result: 'ok' | 'blocked' | 'failed';
  note: string | null; // sanitized
}

export interface TaskContext {
  task_id: string;
  task_text: string; // raw user intent — local zone
  allowed_actions: ActionType[];
  allowed_origins: Origin[];
  step_index: number;
  history: StepSummary[];
}

export interface SanitizeRequest {
  cycle_id: string;
  task: TaskContext;
  frame: PerceptionFrame;
  mode: 'normal' | 'strict_text_only';
  include_image: boolean;
  image_data_url?: string;
}

export interface AttestedPayload { // the ONLY thing network/ will send
  request_id: string;
  body: string; // exact JSON string that goes on the wire
  sha256: string; // hex SHA-256 of `body` (Web Crypto)
  issued_at: number;
}

export interface SanitizeResult {
  cycle_id: string;
  verdict: 'SAFE' | 'BLOCK';
  attested: AttestedPayload | null;
  block: { checks_failed: string[]; reasons: string[] } | null; // reasons contain no raw values
  detections: PiiDetection[];
  masked_data_url?: string | null;
  redaction: {
    text_replacements: number;
    masked_boxes: number;
    masked_area_px: number;
    image_included: boolean;
  };
  timings_ms: Partial<
    Record<'pii' | 'fusion' | 'relevance' | 'redact' | 'firewall' | 'total', number>
  >;
}

export interface CapabilityDescriptor {
  ref: string;
  kind: 'password' | 'email' | 'phone' | 'token' | 'profile';
  label: string;
}
