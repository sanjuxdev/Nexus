import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type {
  StructuredAction,
  TargetResolution,
  TaskSession,
} from '@contracts/index.js';
import { validateAction } from '../../extension/src/actions/validator/index.js';

function makeMockSession(overrides: Partial<TaskSession> = {}): TaskSession {
  return {
    task_id: 'task_test_01',
    task_text: 'Test task',
    tab_id: 1,
    allowed_origins: ['http://localhost:5173'],
    allowed_actions: ['click', 'type', 'fill_secret', 'select', 'scroll', 'focus', 'keypress'],
    step_index: 1,
    max_steps: 10,
    state: 'VALIDATING',
    frame_page_state_hash: 'hash_1234567890ab',
    region_index: {
      r1: {
        frame_id: 'main',
        origin: 'http://localhost:5173',
        dom_id: 'd1',
        local_key: 'd1',
        bbox: [100, 100, 100, 40],
        semantic_type: 'button',
        interactable: true,
        injection_suspected: false,
      },
      r_pwd: {
        frame_id: 'main',
        origin: 'http://localhost:5173',
        dom_id: 'd2',
        local_key: 'd2',
        bbox: [100, 160, 200, 40],
        semantic_type: 'input',
        interactable: true,
        injection_suspected: false,
      },
      r_injected: {
        frame_id: 'main',
        origin: 'http://localhost:5173',
        dom_id: 'd3',
        local_key: 'd3',
        bbox: [100, 220, 200, 40],
        semantic_type: 'button',
        interactable: true,
        injection_suspected: true,
      },
    },
    history: [],
    recent_state_hashes: [],
    ...overrides,
  };
}

function makeMockAction(overrides: Partial<StructuredAction> = {}): StructuredAction {
  return {
    action_id: 'act_01',
    request_id: 'req_01',
    action: 'click',
    target: { region_id: 'r1' },
    params: null,
    capability: null,
    origin: 'http://localhost:5173',
    frame_id: 'main',
    page_state_hash: 'hash_1234567890ab',
    rationale: 'Click valid target',
    ...overrides,
  };
}

const validTargetRes: TargetResolution = {
  exists: true,
  visible: true,
  interactable: true,
  occluded: false,
  bbox: [100, 100, 100, 40],
  origin: 'http://localhost:5173',
  frame_id: 'main',
  semantic_type: 'button',
  input_type: null,
  is_password: false,
};

describe('Action Firewall Table-Driven Tests', () => {
  it('passes completely on a valid action', async () => {
    const session = makeMockSession();
    const action = makeMockAction();
    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(true);
    expect(verdict.failed_step).toBeNull();
    expect(verdict.checks.every((c) => c.ok)).toBe(true);
  });

  // Step 1: Schema check
  it('Step 1: rejects arbitrary unknown action / schema violation', async () => {
    const session = makeMockSession();
    const badAction = { ...makeMockAction(), action: 'eval_arbitrary_code' };
    const verdict = await validateAction(badAction, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('schema');
    expect(verdict.code).toBe('SERVER_INVALID');
  });

  // Step 2: Policy check (disallowed action)
  it('Step 2: rejects action not in session.allowed_actions', async () => {
    const session = makeMockSession({ allowed_actions: ['scroll'] });
    const action = makeMockAction({ action: 'click' });
    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('policy');
    expect(verdict.code).toBe('POLICY_DENIED');
  });

  // Step 2: Policy check (type on password input)
  it('Step 2: rejects direct "type" on password field', async () => {
    const session = makeMockSession();
    const action = makeMockAction({
      action: 'type',
      target: { region_id: 'r_pwd' },
      params: { text: 'my-password' },
    });
    const pwdRes: TargetResolution = { ...validTargetRes, is_password: true, input_type: 'password' };

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: pwdRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('policy');
    expect(verdict.reason).toContain('Must use "fill_secret" capability');
  });

  // Step 2: Policy check (prompt injection target)
  it('Step 2: rejects action on suspected prompt injection target', async () => {
    const session = makeMockSession();
    const action = makeMockAction({ target: { region_id: 'r_injected' } });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('policy');
    expect(verdict.reason).toContain('suspected prompt injection');
  });

  // Step 3: Origin check
  it('Step 3: rejects origin mismatch with live page', async () => {
    const session = makeMockSession();
    const action = makeMockAction({ origin: 'https://attacker.evil' });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('origin');
    expect(verdict.code).toBe('ORIGIN_MISMATCH');
  });

  // Step 4: Frame check
  it('Step 4: rejects frame_id mismatch with target entry', async () => {
    const session = makeMockSession();
    const action = makeMockAction({ frame_id: 'iframe_2' });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'iframe_2',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('frame');
    expect(verdict.code).toBe('FRAME_MISMATCH');
  });

  // Step 5: State check
  it('Step 5: rejects stale page state hash', async () => {
    const session = makeMockSession();
    const action = makeMockAction({ page_state_hash: 'old_hash_000000' });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('state');
    expect(verdict.code).toBe('STALE_STATE');
  });

  // Step 6: Target check
  it('Step 6: rejects unknown target region_id (I7 enforcement)', async () => {
    const session = makeMockSession();
    const action = makeMockAction({ target: { region_id: 'r_nonexistent' } });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('target');
    expect(verdict.code).toBe('TARGET_NOT_FOUND');
  });

  // Step 7: Visibility & interactability check
  it('Step 7: rejects occluded element', async () => {
    const session = makeMockSession();
    const action = makeMockAction();
    const occludedRes: TargetResolution = { ...validTargetRes, occluded: true };

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: occludedRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('visibility');
    expect(verdict.code).toBe('NOT_INTERACTABLE');
  });

  // Step 8: Capability check
  it('Step 8: rejects unauthorized capability for fill_secret', async () => {
    const session = makeMockSession();
    const action = makeMockAction({
      action: 'fill_secret',
      capability: 'cap_unauthorized_999',
    });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('capability');
    expect(verdict.code).toBe('CAPABILITY_DENIED');
  });

  // Step 9: Text scan check
  it('Step 9: rejects outbound text containing raw email in params.text', async () => {
    const session = makeMockSession();
    const action = makeMockAction({
      action: 'type',
      target: { region_id: 'r1' },
      params: { text: 'leaked_user@secret.com' },
    });

    const verdict = await validateAction(action, {
      session,
      liveOrigin: 'http://localhost:5173',
      liveFrameId: 'main',
      recentStateHashes: ['hash_1234567890ab'],
      targetResolution: validTargetRes,
    });

    expect(verdict.valid).toBe(false);
    expect(verdict.failed_step).toBe('text_scan');
    expect(verdict.code).toBe('TEXT_UNSAFE');
  });
});
