import {
  ActionRequest,
  ValidationResult,
  SupportedActionType,
  ActionValidationErrorCode,
  ValidatedExecutionTicket,
} from '@contracts/action-validator.js';
import type { ExecResult, StructuredAction } from '@contracts/index.js';
import {
  ActionValidator,
  ObservationContext,
  actionValidator,
} from './action-validator.js';
import { executeAction as defaultExecuteAction } from '../actions/executor/index.js';

/**
 * Phase 4: Controlled Execution Boundary
 * 
 * Provides a strictly enforced, fail-closed execution boundary between the
 * Action Validator and the existing browser Action Executor.
 * 
 * SECURITY PRINCIPLE:
 * VALIDATION FAILURE = NO EXECUTION.
 * UNVALIDATED ATTEMPT = NO EXECUTION.
 * 
 * Any action that has not passed validation with a genuine, non-expired,
 * non-replayed ticket is barred from reaching the executor.
 */

export interface ExecutionBoundaryResult {
  executed: boolean;
  action_id?: string;
  verdict: ValidationResult;
  exec_result?: ExecResult;
  error?: {
    code: ActionValidationErrorCode | string;
    message: string;
  };
}

export type ActionExecutorFn = (
  action: StructuredAction,
  resolvedSecret?: string
) => Promise<ExecResult>;

export interface ExecutionOptions {
  resolvedSecret?: string;
  executor?: ActionExecutorFn;
}

export class ControlledExecutionBoundary {
  private consumedTickets = new Set<string>();
  private validator: ActionValidator;
  private defaultExecutor: ActionExecutorFn;

  constructor(options?: {
    validator?: ActionValidator;
    executor?: ActionExecutorFn;
  }) {
    this.validator = options?.validator || actionValidator;
    this.defaultExecutor = options?.executor || defaultExecuteAction;
  }

  /**
   * Primary full-pipeline entry point:
   * Validates the incoming ActionRequest against observation context,
   * and ONLY if ALLOWED, forwards to the execution boundary and executor.
   */
  public async validateAndExecute(
    rawRequest: unknown,
    context?: ObservationContext,
    options?: ExecutionOptions
  ): Promise<ExecutionBoundaryResult> {
    // 1. Validation Step
    let verdict: ValidationResult;
    try {
      verdict = this.validator.validate(rawRequest, context);
    } catch (err: any) {
      // Exceptions during validation MUST fail closed
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: `Validation threw an unexpected exception: ${err?.message || String(err)}`,
          code: 'VALIDATION_EXCEPTION',
          failed_check: 'validation_exception',
        },
        error: {
          code: 'VALIDATION_EXCEPTION',
          message: `Validation exception: ${err?.message || String(err)}`,
        },
      };
    }

    // 2. Gate Check: On denial or missing ticket, NEVER reach executor
    if (!verdict.allowed) {
      return {
        executed: false,
        verdict,
        error: {
          code: verdict.code,
          message: verdict.reason,
        },
      };
    }

    if (!verdict.ticket) {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: 'Execution denied: Allowed verdict did not provide an execution ticket',
          code: 'NO_VALIDATION_VERDICT',
        },
        error: {
          code: 'NO_VALIDATION_VERDICT',
          message: 'Execution denied: Missing execution ticket',
        },
      };
    }

    // 3. Execution Boundary Step
    if (!context) {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: 'Execution denied: Context missing at execution boundary',
          code: 'INVALID_OBSERVATION',
        },
        error: {
          code: 'INVALID_OBSERVATION',
          message: 'Execution denied: Context missing at execution boundary',
        },
      };
    }

    return this.executeValidated(verdict.ticket, context, options);
  }

  /**
   * Narrow execution boundary interface:
   * Accepts ONLY a genuine, unexpired, unconsumed ValidatedExecutionTicket.
   * Rejects unvalidated or direct calls.
   */
  public async executeValidated(
    ticket: unknown,
    context: ObservationContext,
    options?: ExecutionOptions
  ): Promise<ExecutionBoundaryResult> {
    // Check 1: Verdict ticket presence
    if (!ticket || typeof ticket !== 'object') {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: 'Execution denied: No validated action ticket provided',
          code: 'NO_VALIDATION_VERDICT',
        },
        error: {
          code: 'NO_VALIDATION_VERDICT',
          message: 'Execution denied: No validation verdict provided',
        },
      };
    }

    // Check 2: Ticket authenticity check (must be signed and registered by validator)
    if (!this.validator.verifyTicket(ticket)) {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: 'Execution denied: Unvalidated or forged execution ticket rejected',
          code: 'UNVALIDATED_EXECUTION_ATTEMPT',
        },
        error: {
          code: 'UNVALIDATED_EXECUTION_ATTEMPT',
          message: 'Execution denied: Direct or unvalidated execution attempt rejected',
        },
      };
    }

    const validTicket = ticket as ValidatedExecutionTicket;

    // Check 3: Expired ticket check
    const now = Date.now();
    if (now - validTicket.validated_at > validTicket.ttl_ms) {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: `Execution denied: Validation ticket has expired (${now - validTicket.validated_at}ms > ${validTicket.ttl_ms}ms)`,
          code: 'EXPIRED_VERDICT',
        },
        error: {
          code: 'EXPIRED_VERDICT',
          message: 'Execution denied: Validated action ticket has expired',
        },
      };
    }

    // Check 4: Replay prevention check
    if (this.consumedTickets.has(validTicket.ticket_id)) {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: `Execution denied: Validation ticket '${validTicket.ticket_id}' has already been consumed (replay prevention)`,
          code: 'REPLAY_REJECTED',
        },
        error: {
          code: 'REPLAY_REJECTED',
          message: 'Execution denied: Ticket already consumed',
        },
      };
    }

    // Check 5: Live observation binding check
    if (!context || context.is_stale || validTicket.observation_id !== context.observation_id) {
      return {
        executed: false,
        verdict: {
          allowed: false,
          reason: `Execution denied: Active observation mismatch (ticket: ${validTicket.observation_id}, context: ${context?.observation_id})`,
          code: 'OBSERVATION_MISMATCH',
        },
        error: {
          code: 'OBSERVATION_MISMATCH',
          message: 'Execution denied: Observation state mismatch',
        },
      };
    }

    // Check 6: Target existence check at execution time
    const targetRequiredActions: SupportedActionType[] = ['click', 'type', 'focus', 'select', 'fill_secret'];
    if (targetRequiredActions.includes(validTicket.action_type) && validTicket.target_id) {
      const liveTarget = context.targets ? context.targets[validTicket.target_id] : undefined;
      if (!liveTarget || liveTarget.visible === false || liveTarget.interactable === false) {
        return {
          executed: false,
          verdict: {
            allowed: false,
            reason: `Execution denied: Target '${validTicket.target_id}' state changed before execution`,
            code: 'TARGET_MISMATCH',
          },
          error: {
            code: 'TARGET_MISMATCH',
            message: 'Execution denied: Target element state mismatch',
          },
        };
      }
    }

    // Mark ticket consumed immediately to prevent concurrency replays
    this.consumedTickets.add(validTicket.ticket_id);

    // Check 7: Translate verified ticket to StructuredAction for the Existing Action Executor
    const actionId = `exec_${validTicket.ticket_id}_${Date.now()}`;
    const structuredAction: StructuredAction = {
      action_id: actionId,
      request_id: validTicket.request_id,
      action: validTicket.action_type,
      target: validTicket.target_id ? { region_id: validTicket.target_id } : null,
      params: validTicket.params ? (validTicket.params as any) : null,
      capability: validTicket.capability || null,
      origin: context.origin || 'http://localhost',
      frame_id: 'main',
      page_state_hash: validTicket.page_state_hash || context.page_state_hash || '',
    };

    // Check 8: Dispatch to Executor within try/catch
    const executor = options?.executor || this.defaultExecutor;
    try {
      const execResult = await executor(structuredAction, options?.resolvedSecret);
      return {
        executed: true,
        action_id: actionId,
        verdict: {
          allowed: true,
          reason: `Action '${validTicket.action_type}' validated and executed successfully`,
          request_id: validTicket.request_id,
          observation_id: validTicket.observation_id,
          action_type: validTicket.action_type,
          target_id: validTicket.target_id,
          ticket: validTicket,
        },
        exec_result: execResult,
      };
    } catch (err: any) {
      // Catch executor runtime exceptions safely
      return {
        executed: false,
        action_id: actionId,
        verdict: {
          allowed: true,
          reason: `Action was validated, but executor encountered a runtime failure: ${err?.message || String(err)}`,
          request_id: validTicket.request_id,
          observation_id: validTicket.observation_id,
          action_type: validTicket.action_type,
          target_id: validTicket.target_id,
          ticket: validTicket,
        },
        error: {
          code: 'EXECUTOR_RUNTIME_ERROR',
          message: err?.message || String(err),
        },
      };
    }
  }

  /**
   * Rejects direct unvalidated execution attempts.
   */
  public async executeDirect(rawAction: unknown): Promise<ExecutionBoundaryResult> {
    return {
      executed: false,
      verdict: {
        allowed: false,
        reason: 'Execution denied: Direct unvalidated execution is strictly forbidden by policy',
        code: 'UNVALIDATED_EXECUTION_ATTEMPT',
      },
      error: {
        code: 'UNVALIDATED_EXECUTION_ATTEMPT',
        message: 'Execution denied: Direct unvalidated execution is strictly forbidden by policy',
      },
    };
  }
}

export const executionBoundary = new ControlledExecutionBoundary();
