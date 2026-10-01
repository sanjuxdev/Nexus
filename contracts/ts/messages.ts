import type { BBox, FrameId, Origin, SemanticType, StageError, TelemetryEvent } from './common.js';
import type { DomSnapshot } from './dom.js';
import type { Budget } from './router.js';
import type { VisionRequest, VisionResult } from './vision.js';
import type { PiiType, SanitizeRequest, SanitizeResult } from './privacy.js';
import type { ExecResult, StructuredAction, ValidationVerdict } from './action.js';
import type { OrchestratorState, TaskSession } from './session.js';

export type BusResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: StageError };

export interface TargetResolution {
  exists: boolean;
  visible: boolean;
  interactable: boolean;
  occluded: boolean;
  bbox: BBox;
  origin: Origin;
  frame_id: FrameId;
  semantic_type: SemanticType;
  input_type: string | null;
  is_password: boolean;
}

export interface PrivacyAuditItem {
  id: string;
  type: PiiType;
  label: string;
  redacted_as: string;
  method: string;
  bbox?: BBox | null;
}

export interface PrivacyAudit {
  attestation_digest: string | null;
  egress_body_preview: string | null;
  masked_image_url?: string | null;
  items: PrivacyAuditItem[];
  stats: {
    total_redactions: number;
    text_replacements: number;
    masked_boxes: number;
    masked_area_px: number;
  };
}

export interface UiState {
  task_id: string | null;
  task_text: string;
  state: OrchestratorState;
  cycle_id: string | null;
  step_index: number;
  max_steps: number;
  last_error: StageError | null;
  last_verdict: ValidationVerdict | null;
  last_action: StructuredAction | null;
  last_exec_result: ExecResult | null;
  routes: { region_key: string; level: string; reasons: string[] }[];
  pii_summary: { type: PiiType; count: number }[];
  attestation_status: 'none' | 'verified' | 'tampered' | 'blocked';
  requires_user_confirmation: boolean;
  pending_action_description: string | null;
  session?: TaskSession;
  privacy_audit?: PrivacyAudit;
}

export interface MessageMap {
  'privacy/start': {
    payload: { tab_id?: number };
    response: { task_id: string };
  };
  'privacy/stop': {
    payload: { task_id: string };
    response: { cancelled: boolean };
  };
  'task/confirm': {
    payload: { task_id: string; confirmed: boolean };
    response: { acknowledged: boolean };
  };
  'ui/state': {
    payload: UiState;
    response: { received: boolean };
  };
  'ui/get-state': {
    payload: Record<string, never>;
    response: UiState;
  };
  'dom/snapshot': {
    payload: Record<string, never>;
    response: DomSnapshot;
  };
  'dom/fingerprint': {
    payload: Record<string, never>;
    response: { page_state_hash: string; origin: Origin; frame_id: FrameId };
  };
  'dom/dirty': {
    payload: {
      reason: string;
      bbox: BBox | null;
      frame_id: FrameId;
      ts: number;
    };
    response: { received: boolean };
  };
  'registry/set': {
    payload: { mapping: Record<string, string> };
    response: { applied: boolean };
  };
  'action/resolve-target': {
    payload: { region_id: string };
    response: TargetResolution;
  };
  'action/execute': {
    payload: { action: StructuredAction; resolved_secret?: string };
    response: ExecResult;
  };
  'vision/budget': {
    payload: Record<string, never>;
    response: Budget;
  };
  'vision/perceive': {
    payload: VisionRequest;
    response: VisionResult;
  };
  'vision/release': {
    payload: { capture_id: string };
    response: { released: boolean };
  };
  'privacy/sanitize': {
    payload: SanitizeRequest;
    response: SanitizeResult;
  };
  'privacy/scan-text': {
    payload: { text: string };
    response: { safe: boolean; findings: { type: PiiType; span: [number, number] }[] };
  };
  'telemetry/event': {
    payload: TelemetryEvent;
    response: { recorded: boolean };
  };
  'offscreen/ready': {
    payload: { ready: boolean };
    response: { acknowledged: boolean };
  };
  'test/inject-dom-change': {
    payload: { html: string };
    response: { injected: boolean };
  };
  'test/get-last-hash': {
    payload: Record<string, never>;
    response: { page_state_hash: string };
  };
}

export type MessageType = keyof MessageMap;
