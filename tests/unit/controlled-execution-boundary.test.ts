import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ControlledExecutionBoundary,
  ExecutionBoundaryResult,
} from '../../extension/src/security/execution-boundary.js';
import {
  ActionValidator,
  ObservationContext,
  actionValidator,
} from '../../extension/src/security/action-validator.js';
import { executeAction } from '../../extension/src/actions/executor/index.js';
import { elementRegistry } from '../../extension/src/content/registry.js';
import type { ExecResult, StructuredAction } from '../../contracts/ts/index.js';

describe('Phase 4: Controlled Execution Boundary Tests', () => {
  let mockExecutor: ReturnType<typeof vi.fn>;
  let boundary: ControlledExecutionBoundary;

  const validContext: ObservationContext = {
    observation_id: 'obs_phase4_live',
    page_state_hash: 'hash_live_001',
    origin: 'http://localhost:3000',
    timestamp: Date.now(),
    ttl_ms: 15000,
    targets: {
      'btn-checkout': {
        target_id: 'btn-checkout',
        role: 'button',
        tag: 'button',
        bbox: [100, 200, 120, 40],
        visible: true,
        interactable: true,
        allowed_actions: ['click'],
      },
      'input-search': {
        target_id: 'input-search',
        role: 'textbox',
        tag: 'input',
        bbox: [100, 100, 300, 35],
        visible: true,
        interactable: true,
        allowed_actions: ['type', 'focus', 'click'],
      },
      'input-card-secret': {
        target_id: 'input-card-secret',
        role: 'textbox',
        tag: 'input',
        bbox: [100, 250, 300, 35],
        visible: true,
        interactable: true,
        is_password: true,
        allowed_actions: ['fill_secret', 'focus', 'click'],
      },
      'btn-disabled': {
        target_id: 'btn-disabled',
        role: 'button',
        bbox: [100, 300, 120, 40],
        visible: true,
        interactable: false,
        allowed_actions: ['click'],
      },
    },
  };

  beforeEach(() => {
    mockExecutor = vi.fn().mockResolvedValue({
      ok: true,
      action_id: 'mock_exec_id',
      navigated: false,
      new_page_state_hash: 'hash_live_002',
    } as ExecResult);

    boundary = new ControlledExecutionBoundary({
      executor: mockExecutor,
    });
  });

  // 1. Valid click reaches executor
  it('1. allows a valid click action to reach the executor', async () => {
    const validClickReq = {
      request_id: 'req_click_01',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'click',
        target_id: 'btn-checkout',
      },
    };

    const res = await boundary.validateAndExecute(validClickReq, validContext);
    expect(res.executed).toBe(true);
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const executedAction: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(executedAction.action).toBe('click');
    expect(executedAction.target?.region_id).toBe('btn-checkout');
    expect(executedAction.request_id).toBe('req_click_01');
  });

  // 2. Valid type reaches executor
  it('2. allows a valid type action to reach the executor with parameters', async () => {
    const validTypeReq = {
      request_id: 'req_type_01',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'type',
        target_id: 'input-search',
        params: {
          text: 'Chandrayaan telemetry data',
        },
      },
    };

    const res = await boundary.validateAndExecute(validTypeReq, validContext);
    expect(res.executed).toBe(true);
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const executedAction: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(executedAction.action).toBe('type');
    expect(executedAction.target?.region_id).toBe('input-search');
    expect(executedAction.params?.text).toBe('Chandrayaan telemetry data');
  });

  // 3. Valid scroll reaches executor
  it('3. allows a valid scroll action to reach the executor without target', async () => {
    const validScrollReq = {
      request_id: 'req_scroll_01',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'scroll',
        params: {
          direction: 'down',
          amount: 500,
        },
      },
    };

    const res = await boundary.validateAndExecute(validScrollReq, validContext);
    expect(res.executed).toBe(true);
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const executedAction: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(executedAction.action).toBe('scroll');
    expect(executedAction.params?.direction).toBe('down');
    expect(executedAction.params?.amount).toBe(500);
  });

  // 4. Invalid action never reaches executor
  it('4. rejects an invalid/unsupported action and NEVER calls the executor', async () => {
    const invalidActionReq = {
      request_id: 'req_invalid_op',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'delete_database', // Unrecognized action
        target_id: 'btn-checkout',
      },
    };

    const res = await boundary.validateAndExecute(invalidActionReq, validContext);
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('UNSUPPORTED_ACTION');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 5. Stale observation never reaches executor
  it('5. rejects stale observation (mismatched ID or expired TTL) and NEVER calls executor', async () => {
    const staleReq = {
      request_id: 'req_stale_obs',
      observation_id: 'obs_expired_from_earlier',
      action: {
        type: 'click',
        target_id: 'btn-checkout',
      },
    };

    const res = await boundary.validateAndExecute(staleReq, validContext);
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('STALE_OBSERVATION');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 6. Missing target never reaches executor
  it('6. rejects missing target or target not present in observation and NEVER calls executor', async () => {
    const missingTargetReq = {
      request_id: 'req_missing_tgt',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'click',
        target_id: 'btn-phantom-element',
      },
    };

    const res = await boundary.validateAndExecute(missingTargetReq, validContext);
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('TARGET_NOT_FOUND');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 7. Policy-denied action never reaches executor
  it('7. rejects policy-denied action (e.g. typing into a button) and NEVER calls executor', async () => {
    const policyDeniedReq = {
      request_id: 'req_policy_denied',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'type',
        target_id: 'btn-checkout', // button only allows click
        params: {
          text: 'injected text',
        },
      },
    };

    const res = await boundary.validateAndExecute(policyDeniedReq, validContext);
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('POLICY_DENIED');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 8. Invalid capability never reaches executor
  it('8. rejects fill_secret with missing capability token and NEVER calls executor', async () => {
    const missingCapReq = {
      request_id: 'req_missing_cap',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'fill_secret',
        target_id: 'input-card-secret',
      },
      // capability omitted
    };

    const res = await boundary.validateAndExecute(missingCapReq, validContext);
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('CAPABILITY_DENIED');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 9. Validator exception results in no execution
  it('9. fails closed if the validator throws an unexpected exception and NEVER calls executor', async () => {
    const throwingValidator = new ActionValidator();
    vi.spyOn(throwingValidator, 'validate').mockImplementation(() => {
      throw new Error('Fatal memory corruption in validator');
    });

    const boundaryWithFaultyValidator = new ControlledExecutionBoundary({
      validator: throwingValidator,
      executor: mockExecutor,
    });

    const validReq = {
      request_id: 'req_fault',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'click',
        target_id: 'btn-checkout',
      },
    };

    const res = await boundaryWithFaultyValidator.validateAndExecute(validReq, validContext);
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_EXCEPTION');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 10. Executor receives only validated actions
  it('10. verifies that the executor receives strictly the validated action payload with observation context metadata', async () => {
    const validSecretReq = {
      request_id: 'req_secret_01',
      observation_id: 'obs_phase4_live',
      capability: 'cap_vault_01',
      action: {
        type: 'fill_secret',
        target_id: 'input-card-secret',
      },
    };

    const res = await boundary.validateAndExecute(validSecretReq, validContext, {
      resolvedSecret: 'super_secret_pin',
    });
    expect(res.executed).toBe(true);
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const [actionArg, secretArg] = mockExecutor.mock.calls[0];
    expect(actionArg.action).toBe('fill_secret');
    expect(actionArg.target.region_id).toBe('input-card-secret');
    expect(actionArg.capability).toBe('cap_vault_01');
    expect(secretArg).toBe('super_secret_pin');
  });

  // 11. Direct unvalidated execution is rejected
  it('11. rejects direct unvalidated execution attempts when ticket is missing or forged', async () => {
    // 11a: Direct executeDirect invocation
    const directRes = await boundary.executeDirect({ action: 'click', target: { region_id: 'btn-checkout' } });
    expect(directRes.executed).toBe(false);
    expect(directRes.error?.code).toBe('UNVALIDATED_EXECUTION_ATTEMPT');
    expect(mockExecutor).not.toHaveBeenCalled();

    // 11b: Direct executeValidated invocation with a forged unbranded ticket
    const forgedTicket = {
      ticket_id: 'tkt_forged_123',
      request_id: 'req_forged',
      observation_id: 'obs_phase4_live',
      action_type: 'click',
      target_id: 'btn-checkout',
      validated_at: Date.now(),
      ttl_ms: 5000,
      signature: 'fake_signature',
    };

    const forgedRes = await boundary.executeValidated(forgedTicket, validContext);
    expect(forgedRes.executed).toBe(false);
    expect(forgedRes.error?.code).toBe('UNVALIDATED_EXECUTION_ATTEMPT');
    expect(mockExecutor).not.toHaveBeenCalled();

    // 11c: Replay attack: execute the same valid ticket twice
    const validReq = {
      request_id: 'req_replay_test',
      observation_id: 'obs_phase4_live',
      action: { type: 'click', target_id: 'btn-checkout' },
    };
    const validRes = actionValidator.validate(validReq, validContext);
    expect(validRes.allowed).toBe(true);
    if (validRes.allowed && validRes.ticket) {
      // First execution succeeds
      const firstExec = await boundary.executeValidated(validRes.ticket, validContext);
      expect(firstExec.executed).toBe(true);
      expect(mockExecutor).toHaveBeenCalledTimes(1);

      // Replay attempt fails immediately without calling executor
      const replayExec = await boundary.executeValidated(validRes.ticket, validContext);
      expect(replayExec.executed).toBe(false);
      expect(replayExec.error?.code).toBe('REPLAY_REJECTED');
      expect(mockExecutor).toHaveBeenCalledTimes(1); // Still 1!
    }
  });

  // 12. Existing valid executor behavior remains unchanged
  it('12. preserves existing executor behavior and correctly handles executor runtime failure', async () => {
    // Make executor throw an error
    mockExecutor.mockRejectedValueOnce(new Error('Browser target disconnected'));

    const validReq = {
      request_id: 'req_runtime_fail',
      observation_id: 'obs_phase4_live',
      action: {
        type: 'click',
        target_id: 'btn-checkout',
      },
    };

    const res = await boundary.validateAndExecute(validReq, validContext);
    // Was validated, but execution failed at executor level
    expect(res.executed).toBe(false);
    expect(res.error?.code).toBe('EXECUTOR_RUNTIME_ERROR');
    expect(res.error?.message).toContain('Browser target disconnected');
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });
});
