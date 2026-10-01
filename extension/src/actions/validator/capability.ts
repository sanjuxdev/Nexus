import type { StructuredAction, TargetResolution, TaskSession } from '@contracts/index.js';
import { privacyStub } from '../../privacy/engine.js';

export async function validateCapability(
  action: StructuredAction,
  session: TaskSession,
  targetResolution?: TargetResolution
): Promise<{ ok: boolean; reason?: string }> {
  if (action.action !== 'fill_secret') {
    return { ok: true };
  }

  if (!action.capability) {
    return {
      ok: false,
      reason: `Action "fill_secret" requires a non-null capability ref`,
    };
  }

  const authCtx = {
    task_id: session.task_id,
    origin: action.origin,
    frame_id: action.frame_id,
    action: action.action,
    target: {
      semantic_type: targetResolution?.semantic_type || 'input',
      input_type: targetResolution?.input_type || null,
      is_password: targetResolution?.is_password || false,
    },
  };

  const auth = await privacyStub.vault.authorize(action.capability, authCtx);
  if (!auth.ok) {
    return {
      ok: false,
      reason: auth.reason || `Capability denied for ref "${action.capability}"`,
    };
  }

  return { ok: true };
}
