export type BBox = [x: number, y: number, w: number, h: number]; // CSS px, TOP-LEVEL viewport space
export type Origin = string; // "https://example.com" — scheme+host+port only, never a full URL
export type FrameId = string; // "main" | "f1" | "f2" ...
export type Source = 'DOM' | 'ARIA' | 'VISION' | 'OCR';

export type SemanticType =
  | 'button' | 'input' | 'checkbox' | 'dropdown' | 'link' | 'tab' | 'menu' | 'dialog'
  | 'chart' | 'table' | 'card' | 'navigation' | 'image' | 'text' | 'custom_control' | 'unknown';

export type VisualState =
  | 'enabled' | 'disabled' | 'selected' | 'expanded' | 'collapsed'
  | 'focused' | 'checked' | 'unchecked' | 'visible';

export type StageName =
  | 'capture' | 'dom' | 'route' | 'vision' | 'ocr' | 'face' | 'ground' | 'fuse'
  | 'pii' | 'redact' | 'firewall' | 'network' | 'server' | 'validate' | 'execute' | 'settle';

export type StageErrorCode =
  | 'VISION_UNAVAILABLE' | 'PRIVACY_BLOCK' | 'PRIVACY_ERROR' | 'SERVER_UNAVAILABLE'
  | 'SERVER_INVALID' | 'STALE_STATE' | 'ORIGIN_MISMATCH' | 'FRAME_MISMATCH'
  | 'POLICY_DENIED' | 'TARGET_NOT_FOUND' | 'NOT_INTERACTABLE'
  | 'CAPABILITY_DENIED' | 'TEXT_UNSAFE' | 'TIMEOUT' | 'INTERNAL';

export interface StageError {
  code: StageErrorCode;
  stage: StageName;
  message: string; // NEVER contains raw page text, PII or secrets
  retryable: boolean;
  detail?: Record<string, string | number | boolean>;
}

export interface TelemetryEvent {
  ts: number;
  cycle_id: string;
  stage: StageName;
  duration_ms: number; // performance.now() delta, keep 3 decimals — never round to 0
  meta?: Record<string, string | number | boolean>; // counts/ids/enums ONLY, no raw text
}

export function stageError(
  code: StageErrorCode,
  stage: StageName,
  message: string,
  retryable = false,
  detail?: Record<string, string | number | boolean>
): StageError {
  return { code, stage, message, retryable, detail };
}
