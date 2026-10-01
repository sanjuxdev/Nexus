import type { FrameId, Origin, StageError } from './common.js';

export type ActionType =
  | 'click'
  | 'scroll'
  | 'focus'
  | 'select'
  | 'type'
  | 'keypress'
  | 'fill_secret'
  | 'navigate'
  | 'back';

export interface StructuredAction {
  action_id: string;
  request_id: string;
  action: ActionType;
  target: { region_id: string } | null; // server may ONLY use region_ids it was shown
  params: {
    text?: string;
    option?: string;
    key?: string;
    direction?: 'up' | 'down' | 'left' | 'right';
    amount?: number;
  } | null;
  capability: string | null; // "cap_pwd_01" for fill_secret
  origin: Origin;
  frame_id: FrameId;
  page_state_hash: string; // set by SERVER from request ctx, not by the LLM
  rationale?: string; // UI display only — never used in decisions
  attestation?: string; // Cryptographic attestation from the server
}

export interface PlanResponse {
  request_id: string;
  status: 'action' | 'done' | 'need_user' | 'fail';
  action: StructuredAction | null;
  message: string | null;
  usage: { server_ms: number; model: string };
}

export type ValidationStep =
  | 'schema'
  | 'policy'
  | 'origin'
  | 'frame'
  | 'state'
  | 'target'
  | 'visibility'
  | 'capability'
  | 'text_scan'
  | 'attestation';

export interface ValidationVerdict {
  valid: boolean;
  failed_step: ValidationStep | null;
  code: StageError['code'] | null;
  reason: string | null;
  checks: { step: ValidationStep; ok: boolean }[];
  requires_user_confirmation?: boolean;
}

export interface ExecResult {
  ok: boolean;
  action_id: string;
  navigated: boolean;
  new_page_state_hash: string | null;
  error?: StageError;
}
