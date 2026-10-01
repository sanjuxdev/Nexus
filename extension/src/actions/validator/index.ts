import type {
  StageErrorCode,
  StructuredAction,
  TargetResolution,
  TaskSession,
  ValidationStep,
  ValidationVerdict,
} from '@contracts/index.js';
import { validateSchema } from './schema-check.js';
import { validatePolicy } from './policy.js';
import { validateFrame, validateOrigin } from './origin-frame.js';
import { validateState } from './state.js';
import { validateTarget, validateVisibilityAndInteractability } from './target.js';
import { validateCapability } from './capability.js';
import { validateTextScan } from './text-scan.js';
import { validateAttestation } from './attestation.js';

export interface ValidationContext {
  session: TaskSession;
  liveOrigin: string;
  liveFrameId: string;
  recentStateHashes: string[];
  targetResolution?: TargetResolution;
}

export async function validateAction(
  rawAction: unknown,
  ctx: ValidationContext
): Promise<ValidationVerdict> {
  const checks: { step: ValidationStep; ok: boolean }[] = [];

  // Step 1: schema
  const schemaRes = validateSchema(rawAction);
  checks.push({ step: 'schema', ok: schemaRes.ok });
  if (!schemaRes.ok) {
    return {
      valid: false,
      failed_step: 'schema',
      code: 'SERVER_INVALID',
      reason: schemaRes.reason || 'Schema validation failed',
      checks,
    };
  }

  const action = rawAction as StructuredAction;

  // Resolve target details if present
  const isPassword = Boolean(ctx.targetResolution?.is_password);
  const targetEntry = action.target ? ctx.session.region_index[action.target.region_id] : undefined;
  const isInjectionSuspected = Boolean(targetEntry?.injection_suspected);

  // Step 2: policy
  const policyRes = validatePolicy(
    action,
    ctx.session,
    isPassword,
    isInjectionSuspected
  );
  checks.push({ step: 'policy', ok: policyRes.ok });
  if (!policyRes.ok) {
    return {
      valid: false,
      failed_step: 'policy',
      code: 'POLICY_DENIED',
      reason: policyRes.reason || 'Policy check failed',
      checks,
    };
  }

  // Step 3: origin
  const originRes = validateOrigin(action, ctx.session, ctx.liveOrigin);
  checks.push({ step: 'origin', ok: originRes.ok });
  if (!originRes.ok) {
    return {
      valid: false,
      failed_step: 'origin',
      code: 'ORIGIN_MISMATCH',
      reason: originRes.reason || 'Origin check failed',
      checks,
    };
  }

  // Step 4: frame
  const frameRes = validateFrame(action, ctx.session, ctx.liveFrameId);
  checks.push({ step: 'frame', ok: frameRes.ok });
  if (!frameRes.ok) {
    return {
      valid: false,
      failed_step: 'frame',
      code: 'FRAME_MISMATCH',
      reason: frameRes.reason || 'Frame check failed',
      checks,
    };
  }

  // Step 5: state
  const stateRes = validateState(action, ctx.recentStateHashes);
  checks.push({ step: 'state', ok: stateRes.ok });
  if (!stateRes.ok) {
    return {
      valid: false,
      failed_step: 'state',
      code: 'STALE_STATE',
      reason: stateRes.reason || 'State hash mismatch',
      checks,
    };
  }

  // Step 6: target
  const targetRes = validateTarget(action, ctx.session, ctx.targetResolution);
  checks.push({ step: 'target', ok: targetRes.ok });
  if (!targetRes.ok) {
    return {
      valid: false,
      failed_step: 'target',
      code: 'TARGET_NOT_FOUND',
      reason: targetRes.reason || 'Target check failed',
      checks,
    };
  }

  // Step 7: visibility & interactability
  const visRes = validateVisibilityAndInteractability(
    action,
    ctx.session,
    ctx.targetResolution
  );
  checks.push({ step: 'visibility', ok: visRes.ok });
  if (!visRes.ok) {
    return {
      valid: false,
      failed_step: 'visibility',
      code: 'NOT_INTERACTABLE',
      reason: visRes.reason || 'Visibility check failed',
      checks,
    };
  }

  // Step 8: capability
  const capRes = await validateCapability(action, ctx.session, ctx.targetResolution);
  checks.push({ step: 'capability', ok: capRes.ok });
  if (!capRes.ok) {
    return {
      valid: false,
      failed_step: 'capability',
      code: 'CAPABILITY_DENIED',
      reason: capRes.reason || 'Capability check failed',
      checks,
    };
  }

  // Step 9: text_scan
  const textRes = await validateTextScan(action);
  checks.push({ step: 'text_scan', ok: textRes.ok });
  if (!textRes.ok) {
    return {
      valid: false,
      failed_step: 'text_scan',
      code: 'TEXT_UNSAFE',
      reason: textRes.reason || 'Outbound text scan failed',
      checks,
    };
  }

  // Step 10: attestation
  const attRes = await validateAttestation(action);
  checks.push({ step: 'attestation', ok: attRes.ok });
  if (!attRes.ok) {
    return {
      valid: false,
      failed_step: 'attestation',
      code: 'SERVER_INVALID',
      reason: attRes.reason || 'Cryptographic attestation failed',
      checks,
    };
  }

  return {
    valid: true,
    failed_step: null,
    code: null,
    reason: null,
    checks,
    requires_user_confirmation: policyRes.requires_user_confirmation,
  };
}
