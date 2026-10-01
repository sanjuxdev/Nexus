import type { BBox, FrameId, Origin, SemanticType } from './common.js';
import type { ActionType } from './action.js';
import type { StepSummary } from './privacy.js';

export type OrchestratorState =
  | 'IDLE'
  | 'PERCEIVING'
  | 'ROUTING'
  | 'VISION'
  | 'ASSEMBLING'
  | 'SANITIZING'
  | 'PLANNING'
  | 'VALIDATING'
  | 'EXECUTING'
  | 'SETTLING'
  | 'REPERCEIVE'
  | 'DONE'
  | 'NEEDS_USER'
  | 'FAILED'
  | 'BLOCKED_BY_PRIVACY'
  | 'SERVER_UNAVAILABLE';

export interface RegionIndexEntry {
  frame_id: FrameId;
  origin: Origin;
  dom_id: string | null;
  local_key: string;
  bbox: BBox;
  semantic_type: SemanticType;
  interactable: boolean;
  injection_suspected: boolean;
}

export interface TaskSession {
  task_id: string;
  task_text: string;
  tab_id: number;
  allowed_origins: Origin[];
  allowed_actions: ActionType[];
  step_index: number;
  max_steps: number;
  state: OrchestratorState;
  frame_page_state_hash: string | null;
  region_index: Record<string, RegionIndexEntry>; // region_id → metadata (no text)
  history: StepSummary[];
  recent_state_hashes: string[];
}
