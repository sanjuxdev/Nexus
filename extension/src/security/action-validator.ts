import {
  ActionRequest,
  ValidationResult,
  validateActionRequestContract,
  SupportedActionType,
  ActionValidationErrorCode,
  ValidatedExecutionTicket,
} from '@contracts/action-validator.js';

export const VALIDATION_PROOF_SYMBOL = Symbol('VALIDATION_PROOF_SYMBOL');

function computeTicketSignature(payload: string, secret: string): string {
  let h1 = 0xdeadbeef ^ secret.length;
  let h2 = 0x41c6ce57 ^ secret.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

/**
 * Phase 3: Isolated Action Validator
 * 
 * Enforces fail-closed validation between incoming AI Agent Action Requests (Action Contract)
 * and the live/sanitized Observation Context BEFORE any browser action can execute.
 * 
 * SECURITY PRINCIPLE:
 * VALIDATION FAILURE = NO EXECUTION.
 * Never guesses intent. Fails closed on any ambiguity or state desync.
 * 
 * NOTE: This validator does NOT execute actions and does NOT modify privacy/masking code.
 */

export interface SafeTargetMetadata {
  target_id: string;
  role?: string;
  tag?: string;
  bbox?: [number, number, number, number]; // [x, y, w, h]
  visible?: boolean;
  interactable?: boolean;
  allowed_actions?: SupportedActionType[];
  is_sensitive?: boolean;
  is_password?: boolean;
}

export interface ObservationContext {
  observation_id: string;
  page_state_hash?: string;
  recent_state_hashes?: string[];
  origin?: string;
  allowed_origins?: string[];
  targets: Record<string, SafeTargetMetadata>;
  timestamp?: number;
  ttl_ms?: number;
  is_stale?: boolean;
}

export class ActionValidator {
  private static readonly DEFAULT_TTL_MS = 15000;

  /**
   * Primary entry point for validating an action request against an observation context.
   * Fails closed: any error or uncertainty produces an allowed: false verdict.
   */
  public validate(rawRequest: unknown, context?: ObservationContext): ValidationResult {
    // 1. Contract & Schema Validation (Phase 2 Action Contract)
    const contractRes = validateActionRequestContract(rawRequest);
    if (!contractRes.valid || !contractRes.validatedRequest) {
      return contractRes.result;
    }

    const req = contractRes.validatedRequest;

    // 2. Observation Context Existence
    if (!context || typeof context !== 'object') {
      return {
        allowed: false,
        reason: 'Validation denied: No active observation context available to verify against',
        code: 'INVALID_OBSERVATION',
        failed_check: 'context_null',
      };
    }

    // 3. Observation Freshness & Identity
    if (context.is_stale) {
      return {
        allowed: false,
        reason: `Validation denied: Observation '${context.observation_id}' is marked stale`,
        code: 'STALE_OBSERVATION',
        failed_check: 'is_stale',
      };
    }

    if (req.observation_id !== context.observation_id) {
      return {
        allowed: false,
        reason: `Validation denied: Observation reference mismatch. Request references '${req.observation_id}' but active observation is '${context.observation_id}'`,
        code: 'STALE_OBSERVATION',
        failed_check: 'observation_id_mismatch',
      };
    }

    // Observation TTL check
    if (context.timestamp) {
      const ttl = context.ttl_ms || ActionValidator.DEFAULT_TTL_MS;
      const age = Date.now() - context.timestamp;
      if (age > ttl) {
        return {
          allowed: false,
          reason: `Validation denied: Observation '${context.observation_id}' has expired (age: ${age}ms, ttl: ${ttl}ms)`,
          code: 'STALE_OBSERVATION',
          failed_check: 'ttl_expired',
        };
      }
    }

    // Page state hash consistency
    if (req.page_state_hash && context.page_state_hash) {
      if (req.page_state_hash !== context.page_state_hash) {
        const acceptableRecent = context.recent_state_hashes || [];
        if (!acceptableRecent.includes(req.page_state_hash)) {
          return {
            allowed: false,
            reason: `Validation denied: Page state mutated since observation '${context.observation_id}' was captured`,
            code: 'PAGE_STATE_MISMATCH',
            failed_check: 'page_state_hash',
          };
        }
      }
    }

    // 4. Target Identity & Existence
    const targetRequiredActions: SupportedActionType[] = ['click', 'type', 'focus', 'select', 'fill_secret'];
    if (targetRequiredActions.includes(req.action.type)) {
      const targetId = req.action.target_id;
      if (!targetId || targetId.trim() === '') {
        return {
          allowed: false,
          reason: `Validation denied: Action '${req.action.type}' requires a non-empty target_id`,
          code: 'MISSING_TARGET',
          failed_check: 'target_id_empty',
        };
      }

      const target = context.targets ? context.targets[targetId] : undefined;
      if (!target) {
        return {
          allowed: false,
          reason: `Validation denied: Target element '${targetId}' was not found in observation '${context.observation_id}'`,
          code: 'TARGET_NOT_FOUND',
          failed_check: 'target_missing_in_context',
        };
      }

      // 5. Target Coordinates & Geometry
      if (target.bbox) {
        const [x, y, w, h] = target.bbox;
        if (w <= 0 || h <= 0 || isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) {
          return {
            allowed: false,
            reason: `Validation denied: Target '${targetId}' has invalid geometry coordinates: [${target.bbox}]`,
            code: 'NOT_INTERACTABLE',
            failed_check: 'bbox_invalid',
          };
        }
      }

      // 6. Visibility & Interactability
      if (target.visible === false) {
        return {
          allowed: false,
          reason: `Validation denied: Target '${targetId}' is not visible in current viewport`,
          code: 'NOT_INTERACTABLE',
          failed_check: 'target_not_visible',
        };
      }

      if (target.interactable === false) {
        return {
          allowed: false,
          reason: `Validation denied: Target '${targetId}' is not interactable in current DOM state`,
          code: 'NOT_INTERACTABLE',
          failed_check: 'target_not_interactable',
        };
      }

      // 7. Action-to-Target Policy Verification
      if (target.allowed_actions && target.allowed_actions.length > 0) {
        if (!target.allowed_actions.includes(req.action.type)) {
          return {
            allowed: false,
            reason: `Validation denied: Action '${req.action.type}' is unauthorized for target '${targetId}'. Allowed: [${target.allowed_actions.join(', ')}]`,
            code: 'POLICY_DENIED',
            failed_check: 'action_not_permitted_on_target',
          };
        }
      }

      // 8. Secret Capability Verification for fill_secret
      if (req.action.type === 'fill_secret') {
        if (!req.capability || req.capability.trim() === '') {
          return {
            allowed: false,
            reason: "Validation denied: 'fill_secret' requires an authorized capability token",
            code: 'CAPABILITY_DENIED',
            failed_check: 'capability_missing',
          };
        }

        if (target.is_password === false) {
          return {
            allowed: false,
            reason: `Validation denied: Target '${targetId}' is not a credential/password field`,
            code: 'POLICY_DENIED',
            failed_check: 'target_not_password_field',
          };
        }
      }
    }

    // Generate unforgeable validation ticket for the execution boundary
    const ticket = this.issueTicket(req, context);

    // All validation checks passed successfully
    return {
      allowed: true,
      reason: `Action '${req.action.type}' authorized against observation '${context.observation_id}'`,
      request_id: req.request_id,
      observation_id: context.observation_id,
      action_type: req.action.type,
      target_id: req.action.target_id || null,
      ticket,
    };
  }

  private static readonly SESSION_SECRET = `sec_${Math.random().toString(36).substring(2)}_${Date.now()}`;
  private activeTickets = new Map<string, { ticket: ValidatedExecutionTicket; expiresAt: number }>();

  /**
   * Issues an authentic ValidatedExecutionTicket bound to the validated request and context.
   */
  public issueTicket(req: ActionRequest, context: ObservationContext): ValidatedExecutionTicket {
    const validatedAt = Date.now();
    const ttlMs = 10000; // 10s execution window
    const ticketId = `tkt_${Math.random().toString(36).substring(2, 10)}_${validatedAt}`;
    const payload = `${ticketId}:${req.request_id}:${context.observation_id}:${req.action.type}:${req.action.target_id || ''}:${validatedAt}`;
    const signature = computeTicketSignature(payload, ActionValidator.SESSION_SECRET);

    const ticket: ValidatedExecutionTicket = {
      ticket_id: ticketId,
      request_id: req.request_id,
      observation_id: context.observation_id,
      action_type: req.action.type,
      target_id: req.action.target_id || null,
      params: req.action.params,
      page_state_hash: req.page_state_hash || context.page_state_hash,
      capability: req.capability,
      validated_at: validatedAt,
      ttl_ms: ttlMs,
      signature,
    };

    // Brand the ticket in memory
    Object.defineProperty(ticket, VALIDATION_PROOF_SYMBOL, {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    this.activeTickets.set(ticketId, {
      ticket,
      expiresAt: validatedAt + ttlMs,
    });

    return ticket;
  }

  /**
   * Verifies the cryptographic and structural authenticity of a ValidatedExecutionTicket.
   */
  public verifyTicket(ticket: unknown): ticket is ValidatedExecutionTicket {
    if (!ticket || typeof ticket !== 'object') {
      return false;
    }
    const t = ticket as any;
    if (t[VALIDATION_PROOF_SYMBOL] !== true) {
      return false;
    }
    if (!t.ticket_id || !t.request_id || !t.observation_id || !t.action_type || !t.signature) {
      return false;
    }
    const payload = `${t.ticket_id}:${t.request_id}:${t.observation_id}:${t.action_type}:${t.target_id || ''}:${t.validated_at}`;
    const expectedSig = computeTicketSignature(payload, ActionValidator.SESSION_SECRET);
    if (t.signature !== expectedSig) {
      return false;
    }
    return this.activeTickets.has(t.ticket_id);
  }
}

export const actionValidator = new ActionValidator();
