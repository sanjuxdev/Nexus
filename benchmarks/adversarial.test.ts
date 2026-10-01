import { describe, it, expect } from 'vitest';
import { validateTarget, validateVisibilityAndInteractability } from '../extension/src/actions/validator/target.js';
import type { TargetResolution } from '../contracts/ts/index.js';

describe('Adversarial Tests', () => {
  it('should block clickjacking attempts (invisible elements)', () => {
    const mockAction = {
      action_id: 'adv-01',
      request_id: 'req',
      action: 'click',
      target: { region_id: 'btn_123' },
      origin: 'https://malicious.com',
      frame_id: 0,
      page_state_hash: 'hash',
    } as any;

    const mockSession = {
      region_index: {
        'btn_123': {
          region_id: 'btn_123',
          bbox: [0, 0, 100, 30],
        }
      }
    } as any;

    const mockResolution = {
      exists: true,
      visible: false, // hidden element
      occluded: false,
      interactable: true,
      bbox: [0, 0, 100, 30],
    } as any;
    
    const result = validateVisibilityAndInteractability(mockAction, mockSession, mockResolution);
    
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not visible');
  });

  it('should block clickjacking attempts (occluded elements)', () => {
    const mockAction = {
      action_id: 'adv-02',
      target: { region_id: 'btn_123' },
    } as any;

    const mockSession = {
      region_index: { 'btn_123': { bbox: [0, 0, 100, 30] } }
    } as any;

    const mockResolution = {
      exists: true,
      visible: true,
      occluded: true, // occluded by another div
      interactable: true,
      bbox: [0, 0, 100, 30],
    } as any;
    
    const result = validateVisibilityAndInteractability(mockAction, mockSession, mockResolution);
    
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('occluded');
  });

  it('should block excessively drifted elements (DOM manipulation)', () => {
    const mockAction = {
      action_id: 'adv-03',
      target: { region_id: 'btn_123' },
    } as any;

    const mockSession = {
      region_index: { 'btn_123': { bbox: [10, 10, 100, 30] } } // Original position
    } as any;

    const mockResolution = {
      exists: true,
      visible: true,
      occluded: false,
      interactable: true,
      bbox: [900, 900, 100, 30], // Moved to trick user
    } as any;
    
    const result = validateVisibilityAndInteractability(mockAction, mockSession, mockResolution);
    
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('drifted excessively');
  });
});
