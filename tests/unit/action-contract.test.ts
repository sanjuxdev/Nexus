import { describe, it, expect } from 'vitest';
import {
  validateActionRequestContract,
  ActionRequestSchema,
  ValidationResultSchema,
  SUPPORTED_ACTION_TYPES,
} from '@contracts/action-validator.js';

describe('Phase 2: Action Validator Contract Tests', () => {
  describe('Supported Action Types', () => {
    it('supports required MVP actions: click, type, scroll, keypress', () => {
      expect(SUPPORTED_ACTION_TYPES).toContain('click');
      expect(SUPPORTED_ACTION_TYPES).toContain('type');
      expect(SUPPORTED_ACTION_TYPES).toContain('scroll');
      expect(SUPPORTED_ACTION_TYPES).toContain('keypress');
    });
  });

  describe('Valid Action Requests', () => {
    it('validates a valid click request', () => {
      const request = {
        request_id: 'req_click_01',
        observation_id: 'obs_1001',
        action: {
          type: 'click',
          target_id: 'button-submit-17',
        },
      };

      const res = validateActionRequestContract(request);
      expect(res.valid).toBe(true);
      expect(res.result.allowed).toBe(true);
      if (res.result.allowed) {
        expect(res.result.action_type).toBe('click');
        expect(res.result.target_id).toBe('button-submit-17');
        expect(res.result.observation_id).toBe('obs_1001');
      }
    });

    it('validates a valid type request with safe text', () => {
      const request = {
        request_id: 'req_type_01',
        observation_id: 'obs_1001',
        action: {
          type: 'type',
          target_id: 'input-search',
          params: {
            text: 'ISRO Chandrayaan mission details',
          },
        },
      };

      const res = validateActionRequestContract(request);
      expect(res.valid).toBe(true);
      expect(res.result.allowed).toBe(true);
      if (res.result.allowed) {
        expect(res.result.action_type).toBe('type');
        expect(res.result.target_id).toBe('input-search');
      }
    });

    it('validates a valid scroll request', () => {
      const request = {
        request_id: 'req_scroll_01',
        observation_id: 'obs_1002',
        action: {
          type: 'scroll',
          params: {
            direction: 'down',
            amount: 500,
          },
        },
      };

      const res = validateActionRequestContract(request);
      expect(res.valid).toBe(true);
      expect(res.result.allowed).toBe(true);
      if (res.result.allowed) {
        expect(res.result.action_type).toBe('scroll');
        expect(res.result.target_id).toBeNull();
      }
    });

    it('validates a valid keypress request', () => {
      const request = {
        request_id: 'req_key_01',
        observation_id: 'obs_1002',
        action: {
          type: 'keypress',
          params: {
            key: 'Enter',
          },
        },
      };

      const res = validateActionRequestContract(request);
      expect(res.valid).toBe(true);
      expect(res.result.allowed).toBe(true);
      if (res.result.allowed) {
        expect(res.result.action_type).toBe('keypress');
      }
    });
  });

  describe('Contract Rejection / Negative Test Cases', () => {
    it('rejects malformed requests (non-object or null)', () => {
      expect(validateActionRequestContract(null).result.allowed).toBe(false);
      expect(validateActionRequestContract(null).result.code).toBe('MALFORMED_REQUEST');

      expect(validateActionRequestContract('not an object').result.allowed).toBe(false);
      expect(validateActionRequestContract(12345).result.allowed).toBe(false);
      expect(validateActionRequestContract([]).result.allowed).toBe(false);
    });

    it('rejects requests with missing action type', () => {
      const request = {
        request_id: 'req_invalid',
        observation_id: 'obs_1001',
        action: {
          target_id: 'button-1',
        },
      };

      const res = validateActionRequestContract(request);
      expect(res.valid).toBe(false);
      expect(res.result.allowed).toBe(false);
      expect(res.result.code).toBe('MISSING_ACTION_TYPE');
    });

    it('rejects unsupported actions', () => {
      const request = {
        request_id: 'req_unsupported',
        observation_id: 'obs_1001',
        action: {
          type: 'execute_arbitrary_script',
          target_id: 'button-1',
        },
      };

      const res = validateActionRequestContract(request);
      expect(res.valid).toBe(false);
      expect(res.result.allowed).toBe(false);
      expect(res.result.code).toBe('UNSUPPORTED_ACTION');
    });

    it('rejects missing target for target-dependent actions (click, type, focus, select, fill_secret)', () => {
      const clickWithoutTarget = {
        request_id: 'req_no_target',
        observation_id: 'obs_1001',
        action: {
          type: 'click',
        },
      };

      const res = validateActionRequestContract(clickWithoutTarget);
      expect(res.valid).toBe(false);
      expect(res.result.allowed).toBe(false);
      expect(res.result.code).toBe('MISSING_TARGET');
    });

    it('rejects malformed target (empty string target_id)', () => {
      const clickWithEmptyTarget = {
        request_id: 'req_empty_target',
        observation_id: 'obs_1001',
        action: {
          type: 'click',
          target_id: '',
        },
      };

      const res = validateActionRequestContract(clickWithEmptyTarget);
      expect(res.valid).toBe(false);
      expect(res.result.allowed).toBe(false);
      expect(res.result.code).toBe('MISSING_TARGET');
    });

    it('rejects invalid observation reference (missing or empty observation_id)', () => {
      const missingObs = {
        request_id: 'req_missing_obs',
        action: {
          type: 'click',
          target_id: 'button-1',
        },
      };

      const res = validateActionRequestContract(missingObs);
      expect(res.valid).toBe(false);
      expect(res.result.allowed).toBe(false);
      expect(res.result.code).toBe('INVALID_OBSERVATION');

      const emptyObs = {
        request_id: 'req_empty_obs',
        observation_id: '',
        action: {
          type: 'click',
          target_id: 'button-1',
        },
      };

      const res2 = validateActionRequestContract(emptyObs);
      expect(res2.valid).toBe(false);
      expect(res2.result.allowed).toBe(false);
      expect(res2.result.code).toBe('INVALID_OBSERVATION');
    });

    it('rejects prohibited script injection patterns in action params', () => {
      const injectionAttempts = [
        'javascript:alert(1)',
        '<script>fetch("http://attacker.com")</script>',
        'eval(document.cookie)',
        'Function("return process")()',
      ];

      for (const attempt of injectionAttempts) {
        const req = {
          request_id: 'req_attack',
          observation_id: 'obs_1',
          action: {
            type: 'type',
            target_id: 'search-box',
            params: {
              text: attempt,
            },
          },
        };

        const res = validateActionRequestContract(req);
        expect(res.valid).toBe(false);
        expect(res.result.allowed).toBe(false);
        expect(res.result.code).toBe('SCRIPT_INJECTION_REJECTED');
      }
    });

    it('rejects unknown extraneous fields (strict schema enforcement)', () => {
      const rogueFields = {
        request_id: 'req_rogue',
        observation_id: 'obs_1',
        action: {
          type: 'click',
          target_id: 'btn-1',
        },
        malicious_override: true,
      };

      const res = validateActionRequestContract(rogueFields);
      expect(res.valid).toBe(false);
      expect(res.result.allowed).toBe(false);
      expect(res.result.code).toBe('MALFORMED_REQUEST');
    });
  });

  describe('Contract Output Schema Compliance', () => {
    it('produces validation results that adhere to ValidationResultSchema', () => {
      const validReq = {
        request_id: 'req_valid',
        observation_id: 'obs_1',
        action: { type: 'click', target_id: 'btn-1' },
      };

      const passResult = validateActionRequestContract(validReq);
      expect(ValidationResultSchema.safeParse(passResult.result).success).toBe(true);

      const invalidReq = {
        request_id: 'req_bad',
        observation_id: 'obs_1',
        action: { type: 'invalid_type' },
      };

      const failResult = validateActionRequestContract(invalidReq);
      expect(ValidationResultSchema.safeParse(failResult.result).success).toBe(true);
    });
  });
});
