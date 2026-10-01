import { describe, it, expect } from 'vitest';
import type { Budget, DomElementInfo, DomSnapshot } from '@contracts/index.js';
import { route } from '../../extension/src/perception/router/router.js';

function makeSnapshot(elements: DomElementInfo[]): DomSnapshot {
  return {
    snapshot_id: 'snap_test',
    url_origin: 'http://localhost:5173',
    url_path: '/login',
    frames: [
      {
        frame_id: 'main',
        parent_frame_id: null,
        origin: 'http://localhost:5173',
        path: '/login',
        offset: [0, 0],
        accessible: true,
      },
    ],
    elements,
    viewport: { w: 1280, h: 800 },
    dpr: 1,
    scroll: { x: 0, y: 0 },
    page_state_hash: '1234567890abcdef',
    ts: Date.now(),
  };
}

const defaultBudget: Budget = {
  level: 'HIGH',
  backend: 'wasm',
  max_vision_regions: 4,
  max_pixels: 2000000,
  allow_detector: true,
  ocr_mode: 'fast',
};

describe('Confidence Router Heuristics', () => {
  it('routes standard HTML button with accessible name to HIGH (vision_calls = 0)', () => {
    const el: DomElementInfo = {
      dom_id: 'd1',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'button',
      role: 'button',
      name: 'Login',
      text: 'Login',
      aria: {},
      bbox: [100, 100, 120, 36],
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'html',
      has_bg_image: false,
      handlers_hint: true,
      parent_dom_id: null,
    };

    const snap = makeSnapshot([el]);
    const plan = route(snap, null, [], defaultBudget);

    expect(plan.decisions[0]?.level).toBe('HIGH');
    expect(plan.decisions[0]?.needs.length).toBe(0);
    expect(plan.needs_screenshot).toBe(false);
  });

  it('routes canvas element to LOW with full vision detector tasks', () => {
    const el: DomElementInfo = {
      dom_id: 'd_canvas',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'canvas',
      role: null,
      name: null,
      text: '',
      aria: {},
      bbox: [100, 100, 160, 42],
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'canvas',
      has_bg_image: false,
      handlers_hint: true,
      parent_dom_id: null,
    };

    const snap = makeSnapshot([el]);
    const plan = route(snap, null, [], defaultBudget);

    const dec = plan.decisions.find((d) => d.dom_id === 'd_canvas');
    expect(dec?.level).toBe('LOW');
    expect(dec?.needs).toContain('ui_detect');
    expect(dec?.needs).toContain('ocr');
    expect(plan.needs_screenshot).toBe(true);
  });

  it('enforces Invariant I6: large media elements (>1600px area) route to at least MEDIUM with OCR + face', () => {
    const el: DomElementInfo = {
      dom_id: 'd_img',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'img',
      role: 'img',
      name: 'User Profile',
      text: '',
      aria: {},
      bbox: [50, 50, 60, 60], // 3600 px area > 1600 px
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: false,
      rendering: 'img',
      has_bg_image: false,
      handlers_hint: false,
      parent_dom_id: null,
    };

    const snap = makeSnapshot([el]);
    const plan = route(snap, null, [], defaultBudget);

    const dec = plan.decisions.find((d) => d.dom_id === 'd_img');
    expect(dec?.level).toBe('MEDIUM');
    expect(dec?.needs).toContain('ocr');
    expect(dec?.needs).toContain('face');
  });

  it('respects budget capping when vision regions exceed limit', () => {
    const cappedBudget: Budget = { ...defaultBudget, max_vision_regions: 1 };

    const el1: DomElementInfo = {
      dom_id: 'd_c1',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'canvas',
      role: null,
      name: null,
      text: '',
      aria: {},
      bbox: [10, 10, 50, 50],
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'canvas',
      has_bg_image: false,
      handlers_hint: true,
      parent_dom_id: null,
    };

    const el2: DomElementInfo = {
      dom_id: 'd_c2',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'canvas',
      role: null,
      name: null,
      text: '',
      aria: {},
      bbox: [100, 100, 50, 50],
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'canvas',
      has_bg_image: false,
      handlers_hint: true,
      parent_dom_id: null,
    };

    const snap = makeSnapshot([el1, el2]);
    const plan = route(snap, null, [], cappedBudget);

    const dec1 = plan.decisions.find((d) => d.dom_id === 'd_c1');
    const dec2 = plan.decisions.find((d) => d.dom_id === 'd_c2');

    expect(dec1?.crop).not.toBeNull();
    expect(dec2?.reasons).toContain('budget_capped');
    expect(dec2?.crop).toBeNull();
  });
});
