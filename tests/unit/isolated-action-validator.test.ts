import { describe, it, expect } from 'vitest';
import {
  ActionValidator,
  ObservationContext,
  actionValidator,
} from '../../extension/src/security/action-validator.js';

describe('Phase 3: Isolated Action Validator Tests', () => {
  const baseContext: ObservationContext = {
    observation_id: 'obs_live_2026',
    page_state_hash: 'hash_live_state_99',
    recent_state_hashes: ['hash_prior_state_98', 'hash_live_state_99'],
    origin: 'http://localhost:5173',
    timestamp: Date.now(),
    ttl_ms: 15000,
    targets: {
      'btn-submit': {
        target_id: 'btn-submit',
        role: 'button',
        tag: 'button',
        bbox: [200, 400, 100, 40],
        visible: true,
        interactable: true,
        allowed_actions: ['click'],
      },
      'input-email': {
        target_id: 'input-email',
        role: 'textbox',
        tag: 'input',
        bbox: [200, 200, 250, 32],
        visible: true,
        interactable: true,
        allowed_actions: ['type', 'focus', 'click'],
      },
      'input-secret': {
        target_id: 'input-secret',
        role: 'textbox',
        tag: 'input',
        bbox: [200, 260, 250, 32],
        visible: true,
        interactable: true,
        is_password: true,
        allowed_actions: ['fill_secret', 'focus', 'click'],
      },
      'hidden-element': {
        target_id: 'hidden-element',
        bbox: [0, 0, 50, 20],
        visible: false,
        interactable: true,
        allowed_actions: ['click'],
      },
      'disabled-button': {
        target_id: 'disabled-button',
        bbox: [200, 500, 100, 40],
        visible: true,
        interactable: false,
        allowed_actions: ['click'],
      },
      'corrupted-geometry-elem': {
        target_id: 'corrupted-geometry-elem',
        bbox: [200, 200, 0, -10], // invalid width and height
        visible: true,
        interactable: true,
        allowed_actions: ['click'],
      },
    },
  };

  it('validates a valid action against the active observation context without executing', () => {
    const validClickReq = {
      request_id: 'req_001',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
        target_id: 'btn-submit',
      },
    };

    const res = actionValidator.validate(validClickReq, baseContext);
    expect(res.allowed).toBe(true);
    if (res.allowed) {
      expect(res.action_type).toBe('click');
      expect(res.target_id).toBe('btn-submit');
      expect(res.observation_id).toBe('obs_live_2026');
    }
  });

  it('validates a valid typing action with valid target and safe text', () => {
    const validTypeReq = {
      request_id: 'req_002',
      observation_id: 'obs_live_2026',
      action: {
        type: 'type',
        target_id: 'input-email',
        params: {
          text: 'agent@isro.gov.in',
        },
      },
    };

    const res = actionValidator.validate(validTypeReq, baseContext);
    expect(res.allowed).toBe(true);
  });

  it('rejects stale observation when request references an old observation_id', () => {
    const staleReq = {
      request_id: 'req_003',
      observation_id: 'obs_old_2025',
      action: {
        type: 'click',
        target_id: 'btn-submit',
      },
    };

    const res = actionValidator.validate(staleReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('STALE_OBSERVATION');
  });

  it('rejects stale observation when observation is explicitly marked is_stale', () => {
    const staleContext: ObservationContext = {
      ...baseContext,
      is_stale: true,
    };

    const req = {
      request_id: 'req_004',
      observation_id: 'obs_live_2026',
      action: { type: 'click', target_id: 'btn-submit' },
    };

    const res = actionValidator.validate(req, staleContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('STALE_OBSERVATION');
  });

  it('rejects stale observation when observation TTL is exceeded', () => {
    const expiredContext: ObservationContext = {
      ...baseContext,
      timestamp: Date.now() - 30000, // 30s ago
      ttl_ms: 10000, // 10s ttl
    };

    const req = {
      request_id: 'req_005',
      observation_id: 'obs_live_2026',
      action: { type: 'click', target_id: 'btn-submit' },
    };

    const res = actionValidator.validate(req, expiredContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('STALE_OBSERVATION');
  });

  it('rejects action when page state mutated unexpectedly (page_state_hash mismatch)', () => {
    const mutatedReq = {
      request_id: 'req_006',
      observation_id: 'obs_live_2026',
      page_state_hash: 'hash_unknown_mutation_xyz',
      action: { type: 'click', target_id: 'btn-submit' },
    };

    const res = actionValidator.validate(mutatedReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('PAGE_STATE_MISMATCH');
  });

  it('rejects invalid observation when context is completely missing or null', () => {
    const req = {
      request_id: 'req_007',
      observation_id: 'obs_live_2026',
      action: { type: 'click', target_id: 'btn-submit' },
    };

    const res = actionValidator.validate(req, undefined);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('INVALID_OBSERVATION');
  });

  it('rejects missing target for target-dependent actions', () => {
    const missingTargetReq = {
      request_id: 'req_008',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
      },
    };

    const res = actionValidator.validate(missingTargetReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('MISSING_TARGET');
  });

  it('rejects target when target has disappeared from current DOM/observation', () => {
    const missingInContextReq = {
      request_id: 'req_009',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
        target_id: 'btn-disappeared-from-dom',
      },
    };

    const res = actionValidator.validate(missingInContextReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('TARGET_NOT_FOUND');
  });

  it('rejects ambiguous/empty target identifier', () => {
    const emptyTargetReq = {
      request_id: 'req_010',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
        target_id: '',
      },
    };

    const res = actionValidator.validate(emptyTargetReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('MISSING_TARGET');
  });

  it('rejects target with corrupted or invalid geometry coordinates', () => {
    const invalidCoordsReq = {
      request_id: 'req_011',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
        target_id: 'corrupted-geometry-elem',
      },
    };

    const res = actionValidator.validate(invalidCoordsReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('NOT_INTERACTABLE');
  });

  it('rejects actions against hidden or non-visible targets', () => {
    const hiddenReq = {
      request_id: 'req_012',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
        target_id: 'hidden-element',
      },
    };

    const res = actionValidator.validate(hiddenReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('NOT_INTERACTABLE');
  });

  it('rejects actions against non-interactable/disabled targets', () => {
    const disabledReq = {
      request_id: 'req_013',
      observation_id: 'obs_live_2026',
      action: {
        type: 'click',
        target_id: 'disabled-button',
      },
    };

    const res = actionValidator.validate(disabledReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('NOT_INTERACTABLE');
  });

  it('rejects unauthorized action for a target (policy violation)', () => {
    // Attempting to type into a button that only allows click
    const unauthorizedReq = {
      request_id: 'req_014',
      observation_id: 'obs_live_2026',
      action: {
        type: 'type',
        target_id: 'btn-submit',
        params: {
          text: 'attempting text into button',
        },
      },
    };

    const res = actionValidator.validate(unauthorizedReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('POLICY_DENIED');
  });

  it('validates fill_secret when authorized capability and password field match', () => {
    const validSecretReq = {
      request_id: 'req_015',
      observation_id: 'obs_live_2026',
      capability: 'cap_vault_token_01',
      action: {
        type: 'fill_secret',
        target_id: 'input-secret',
      },
    };

    const res = actionValidator.validate(validSecretReq, baseContext);
    expect(res.allowed).toBe(true);
  });

  it('rejects fill_secret when capability token is missing', () => {
    const missingCapReq = {
      request_id: 'req_016',
      observation_id: 'obs_live_2026',
      action: {
        type: 'fill_secret',
        target_id: 'input-secret',
      },
    };

    const res = actionValidator.validate(missingCapReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('CAPABILITY_DENIED');
  });

  it('rejects fill_secret when targeted element is not a credential/password field', () => {
    const wrongTargetReq = {
      request_id: 'req_017',
      observation_id: 'obs_live_2026',
      capability: 'cap_vault_token_01',
      action: {
        type: 'fill_secret',
        target_id: 'input-email', // Not is_password
      },
    };

    const res = actionValidator.validate(wrongTargetReq, baseContext);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('POLICY_DENIED');
  });

  it('fails closed on multiple simultaneous failures without guessing', () => {
    const multiFailureReq = {
      request_id: 'req_multi',
      observation_id: 'obs_wrong', // Failure 1: observation mismatch
      action: {
        type: 'unsupported_op', // Failure 2: unsupported action
        target_id: 'btn-missing', // Failure 3: missing target
      },
    };

    const res = actionValidator.validate(multiFailureReq, baseContext);
    expect(res.allowed).toBe(false);
    // Must immediately fail closed
    expect(res.code).toBeDefined();
  });

  it('validates scroll actions without requiring target element', () => {
    const validScrollReq = {
      request_id: 'req_scroll',
      observation_id: 'obs_live_2026',
      action: {
        type: 'scroll',
        params: {
          direction: 'down',
          amount: 400,
        },
      },
    };

    const res = actionValidator.validate(validScrollReq, baseContext);
    expect(res.allowed).toBe(true);
  });
});
