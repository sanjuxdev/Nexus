import type { StructuredAction, TaskSession } from '@contracts/index.js';

export function validateOrigin(
  action: StructuredAction,
  session: TaskSession,
  liveOrigin: string
): { ok: boolean; reason?: string } {
  if (action.origin !== liveOrigin) {
    return {
      ok: false,
      reason: `Action origin mismatch: action specified "${action.origin}" but live page is "${liveOrigin}"`,
    };
  }

  // Allow local files to be processed
  if (action.origin === 'file://') {
    // Skip allowed_origins check for local files
  } else if (!session.allowed_origins.includes(action.origin)) {
    return {
      ok: false,
      reason: `Action origin "${action.origin}" is not in session allowed_origins`,
    };
  }

  return { ok: true };
}

export function validateFrame(
  action: StructuredAction,
  session: TaskSession,
  liveFrameId: string
): { ok: boolean; reason?: string } {
  if (action.frame_id !== liveFrameId) {
    return {
      ok: false,
      reason: `Action frame_id mismatch: action specified "${action.frame_id}" but live frame is "${liveFrameId}"`,
    };
  }

  if (action.target) {
    const entry = session.region_index[action.target.region_id];
    if (entry && entry.frame_id !== action.frame_id) {
      return {
        ok: false,
        reason: `Target region "${action.target.region_id}" belongs to frame "${entry.frame_id}", not "${action.frame_id}"`,
      };
    }
  }

  return { ok: true };
}
