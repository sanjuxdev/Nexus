import type {
  DomSnapshot,
  TaskSession,
  VisionResult,
  SanitizeResult
} from '@contracts/index.js';

export interface PerceptionCycleRequest {
  cycleId: string;
  session: TaskSession;
  activeAbortController: AbortController | null;
  broadcastUiState: (state: any) => void;
}

export interface PerceptionCycleResult {
  domSnapshot: DomSnapshot;
  plan: any; // The routing decisions
  visionResult: VisionResult | null;
  captureMeta: any;
  frame: any;
  regionIndex: any;
  registryMapping: Record<string, string>;
  sanRes: SanitizeResult;
  latestDataUrl?: string;
  isBlocked: boolean; // Indicates if privacy firewall blocked it
  needsReperceive: boolean; // If true, abort current planner cycle and retry
}

/**
 * Interface defining the boundary between the AI Agent task loop
 * and the browser's autonomous perception & privacy pipeline.
 *
 * This allows the extension to independently run DOM extraction, Vision analysis,
 * and Privacy protection (Sanitization/Masking) without relying on the AI Agent's state machine.
 */
export interface IPerceptionPipeline {
  /**
   * Runs one complete perception and privacy sanitization cycle.
   * Can be driven continuously by the extension's MutationObserver,
   * completely independent of the AI task loop.
   */
  runCycle(request: PerceptionCycleRequest): Promise<PerceptionCycleResult | null>;
}
