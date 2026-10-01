import type { StructuredAction } from '@contracts/index.js';

export function validateState(
  action: StructuredAction,
  recentStateHashes: string[]
): { ok: boolean; reason?: string } {
  if (recentStateHashes.length === 0) {
    return { ok: false, reason: `STALE_STATE: No recent state hashes available for validation.` };
  }

  if (!recentStateHashes.includes(action.page_state_hash)) {
    return {
      ok: false,
      reason: `STALE_STATE: action hash "${action.page_state_hash}" does not match any recent live page hashes [${recentStateHashes.join(', ')}]`,
    };
  }
  return { ok: true };
}
