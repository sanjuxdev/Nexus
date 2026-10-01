import { z } from 'zod';

/**
 * Phase 2: Action Validator Contract
 * 
 * Formal specification for incoming AI Agent (BrowserOS / MCP) action requests,
 * target identity validation, observation freshness tracking, and validation verdicts.
 * 
 * CRITICAL RULE: This contract defines the schema and security validation rules.
 * It does NOT execute browser actions and does NOT interact with the privacy/masking pipeline.
 */

// 1. Supported Action Types (MVP Scope)
export const SUPPORTED_ACTION_TYPES = [
  'click',
  'type',
  'scroll',
  'keypress',
  'focus',
  'select',
  'fill_secret',
] as const;

export type SupportedActionType = typeof SUPPORTED_ACTION_TYPES[number];

export const SupportedActionTypeSchema = z.enum(SUPPORTED_ACTION_TYPES);

// 2. Prohibited code execution patterns (Script injection / eval prevention)
const FORBIDDEN_TEXT_PATTERNS = [
  /javascript:/i,
  /<script[\s>]/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bwindow\.execScript\b/i,
];

// Safe string parameter validator rejecting code injection
export const SafeTextParamSchema = z.string().superRefine((val, ctx) => {
  for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
    if (pattern.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden script injection pattern detected: ${pattern.source}`,
      });
    }
  }
});

// 3. Action Parameters Schema
export const ActionParamsSchema = z.object({
  text: SafeTextParamSchema.optional(),
  key: z.string().min(1).max(50).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().int().min(1).max(10000).optional(),
  option: z.string().optional(),
}).strict().optional().nullable();

export type ActionParams = z.infer<typeof ActionParamsSchema>;

// 4. Action Target Schema
export const ActionTargetSchema = z.object({
  target_id: z.string().min(1, 'target_id cannot be empty'),
  role: z.string().optional(),
  label: z.string().optional(),
}).strict();

export type ActionTarget = z.infer<typeof ActionTargetSchema>;

// 5. Action Payload Schema
export const ActionPayloadSchema = z.object({
  type: SupportedActionTypeSchema,
  target_id: z.string().min(1, 'target_id cannot be empty').optional(),
  params: ActionParamsSchema,
}).strict().superRefine((action, ctx) => {
  // Target existence requirement: click, type, focus, select, fill_secret MUST specify target_id
  const targetRequiredActions: SupportedActionType[] = ['click', 'type', 'focus', 'select', 'fill_secret'];
  if (targetRequiredActions.includes(action.type) && !action.target_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Action '${action.type}' requires a non-empty target_id`,
      path: ['target_id'],
    });
  }

  // Type action requires text parameter
  if (action.type === 'type' && (!action.params || typeof action.params.text !== 'string')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action 'type' requires params.text",
      path: ['params', 'text'],
    });
  }

  // Keypress action requires key parameter
  if (action.type === 'keypress' && (!action.params || typeof action.params.key !== 'string')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action 'keypress' requires params.key",
      path: ['params', 'key'],
    });
  }
});

export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

// 6. Action Request Schema (Received from BrowserOS via MCP)
export const ActionRequestSchema = z.object({
  request_id: z.string().min(1, 'request_id cannot be empty'),
  observation_id: z.string().min(1, 'observation_id cannot be empty'),
  action: ActionPayloadSchema,
  page_state_hash: z.string().optional(),
  capability: z.string().nullable().optional(),
}).strict();

export type ActionRequest = z.infer<typeof ActionRequestSchema>;

// 7. Error Codes for Validation
export const ACTION_VALIDATION_ERROR_CODES = [
  'MALFORMED_REQUEST',
  'MISSING_ACTION_TYPE',
  'UNSUPPORTED_ACTION',
  'MISSING_TARGET',
  'MALFORMED_TARGET',
  'INVALID_OBSERVATION',
  'STALE_OBSERVATION',
  'SCRIPT_INJECTION_REJECTED',
  'PAGE_STATE_MISMATCH',
  'FRAME_MISMATCH',
  'TARGET_NOT_FOUND',
  'NOT_INTERACTABLE',
  'POLICY_DENIED',
  'CAPABILITY_DENIED',
  'TEXT_UNSAFE',
  'UNVALIDATED_EXECUTION_ATTEMPT',
  'EXPIRED_VERDICT',
  'REPLAY_REJECTED',
  'OBSERVATION_MISMATCH',
  'TARGET_MISMATCH',
  'NO_VALIDATION_VERDICT',
  'VALIDATION_EXCEPTION',
  'EXECUTOR_RUNTIME_ERROR',
] as const;

export type ActionValidationErrorCode = typeof ACTION_VALIDATION_ERROR_CODES[number];

// 8. Validated Execution Ticket (issued by Validator upon ALLOW verdict)
export interface ValidatedExecutionTicket {
  ticket_id: string;
  request_id: string;
  observation_id: string;
  action_type: SupportedActionType;
  target_id: string | null;
  params?: ActionParams;
  page_state_hash?: string;
  capability?: string | null;
  validated_at: number;
  ttl_ms: number;
  signature: string;
}

// 9. Validation Result Schema
export const ValidationResultSchema = z.discriminatedUnion('allowed', [
  z.object({
    allowed: z.literal(true),
    reason: z.string(),
    request_id: z.string(),
    observation_id: z.string(),
    action_type: SupportedActionTypeSchema,
    target_id: z.string().nullable().optional(),
    ticket: z.custom<ValidatedExecutionTicket>().optional(),
  }).passthrough(),
  z.object({
    allowed: z.literal(false),
    reason: z.string(),
    code: z.enum(ACTION_VALIDATION_ERROR_CODES),
    failed_check: z.string().optional(),
  }).strict(),
]);

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Pure Schema Validator for Action Requests
 * Validates request structure, supported actions, target parameters, and injection safety.
 * Fails closed on any ambiguity or malformed input.
 */
export function validateActionRequestContract(raw: unknown): {
  valid: boolean;
  result: ValidationResult;
  validatedRequest?: ActionRequest;
} {
  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      result: {
        allowed: false,
        reason: 'Malformed request: payload must be a non-null object',
        code: 'MALFORMED_REQUEST',
      },
    };
  }

  const parseResult = ActionRequestSchema.safeParse(raw);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const path = firstIssue?.path.join('.') || '';
    const message = firstIssue?.message || 'Invalid request schema';

    // Map specific Zod issues to standardized error codes
    let code: ActionValidationErrorCode = 'MALFORMED_REQUEST';
    if (message.includes('Forbidden script injection')) {
      code = 'SCRIPT_INJECTION_REJECTED';
    } else if (path.includes('type') && message.includes('Invalid enum value')) {
      code = 'UNSUPPORTED_ACTION';
    } else if (path.includes('target_id') || message.includes('requires a non-empty target_id')) {
      code = 'MISSING_TARGET';
    } else if (path === 'observation_id') {
      code = 'INVALID_OBSERVATION';
    } else if (path.includes('action.type') && message.includes('Required')) {
      code = 'MISSING_ACTION_TYPE';
    }

    return {
      valid: false,
      result: {
        allowed: false,
        reason: `Contract validation failed [${path}]: ${message}`,
        code,
        failed_check: path,
      },
    };
  }

  const req = parseResult.data;

  return {
    valid: true,
    result: {
      allowed: true,
      reason: 'Action request conforms to Action Contract schema',
      request_id: req.request_id,
      observation_id: req.observation_id,
      action_type: req.action.type,
      target_id: req.action.target_id || null,
    },
    validatedRequest: req,
  };
}
