import type { StructuredAction, TaskSession } from '@contracts/index.js';

const RISKY_KEYWORDS = ['pay', 'transfer', 'delete', 'purchase', 'confirm order', 'checkout'];

export function validatePolicy(
  action: StructuredAction,
  session: TaskSession,
  isPasswordTarget = false,
  isInjectionSuspected = false,
  targetText = ''
): { ok: boolean; reason?: string; requires_user_confirmation?: boolean } {
  // 1. Allowed actions list
  if (!session.allowed_actions.includes(action.action)) {
    return {
      ok: false,
      reason: `Action "${action.action}" is not in session allowed_actions [${session.allowed_actions.join(', ')}]`,
    };
  }

  // 2. Max steps check
  if (session.step_index >= session.max_steps) {
    return {
      ok: false,
      reason: `Session step limit reached (${session.step_index} >= ${session.max_steps})`,
    };
  }

  // 3. Sensitive field policy: 'type' forbidden on password fields
  if (isPasswordTarget && action.action === 'type') {
    return {
      ok: false,
      reason: `Direct "type" action forbidden on password input. Must use "fill_secret" capability.`,
    };
  }

  // 4. Prompt injection protection
  if (isInjectionSuspected && ['click', 'type', 'select', 'fill_secret'].includes(action.action)) {
    return {
      ok: false,
      reason: `Action targets a region flagged as suspected prompt injection. Execution blocked.`,
    };
  }

  // 5. Risky keyword detection
  const lowerText = (targetText || action.rationale || '').toLowerCase();
  const requires_user_confirmation = RISKY_KEYWORDS.some((kw) => lowerText.includes(kw));

  return { ok: true, requires_user_confirmation };
}
