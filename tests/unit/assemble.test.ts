import { describe, it, expect } from 'vitest';
import type { DomElementInfo, DomSnapshot, RoutingPlan, VisionResult } from '@contracts/index.js';
import { assembleFrame } from '../../extension/src/background/assemble-frame.js';

describe('Frame Assembly & Region ID Minting (Invariant I2)', () => {
  it('mints r1, r2... strictly in reading order (y then x)', () => {
    const elTop: DomElementInfo = {
      dom_id: 'd_top',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'input',
      role: 'textbox',
      name: 'Search',
      text: '',
      aria: {},
      bbox: [100, 50, 200, 30], // y = 50
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'html',
      has_bg_image: false,
      handlers_hint: false,
      parent_dom_id: null,
    };

    const elBottomLeft: DomElementInfo = {
      dom_id: 'd_btn_left',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'button',
      role: 'button',
      name: 'Back',
      text: 'Back',
      aria: {},
      bbox: [50, 200, 80, 36], // y = 200, x = 50
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'html',
      has_bg_image: false,
      handlers_hint: true,
      parent_dom_id: null,
    };

    const elBottomRight: DomElementInfo = {
      dom_id: 'd_btn_right',
      frame_id: 'main',
      origin: 'http://localhost:5173',
      tag: 'button',
      role: 'button',
      name: 'Next',
      text: 'Next',
      aria: {},
      bbox: [250, 200, 80, 36], // y = 200, x = 250
      visible: true,
      in_viewport: true,
      occluded: false,
      interactable: true,
      rendering: 'html',
      has_bg_image: false,
      handlers_hint: true,
      parent_dom_id: null,
    };

    const snap: DomSnapshot = {
      snapshot_id: 'snap_01',
      url_origin: 'http://localhost:5173',
      url_path: '/test',
      frames: [],
      elements: [elBottomRight, elTop, elBottomLeft], // Deliberately out of reading order
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_test',
      ts: Date.now(),
    };

    const plan: RoutingPlan = {
      snapshot_id: 'snap_01',
      page_state_hash: 'hash_test',
      decisions: [
        { region_key: 'd_top', dom_id: 'd_top', level: 'HIGH', reasons: [], crop: null, needs: [] },
        { region_key: 'd_btn_left', dom_id: 'd_btn_left', level: 'HIGH', reasons: [], crop: null, needs: [] },
        { region_key: 'd_btn_right', dom_id: 'd_btn_right', level: 'HIGH', reasons: [], crop: null, needs: [] },
      ],
      needs_screenshot: false,
      budget: {
        level: 'HIGH',
        backend: 'wasm',
        max_vision_regions: 4,
        max_pixels: 10000,
        allow_detector: true,
        ocr_mode: 'fast',
      },
    };

    const { frame, regionIndex } = assembleFrame('cycle_01', snap, plan, null, null);

    expect(frame.regions.length).toBe(3);
    // Reading order expectations:
    // 1st: y=50 (d_top) -> r1
    // 2nd: y=200, x=50 (d_btn_left) -> r2
    // 3rd: y=200, x=250 (d_btn_right) -> r3
    expect(frame.regions[0]?.region_id).toBe('r1');
    expect(frame.regions[0]?.local_key).toBe('d_top');

    expect(frame.regions[1]?.region_id).toBe('r2');
    expect(frame.regions[1]?.local_key).toBe('d_btn_left');

    expect(frame.regions[2]?.region_id).toBe('r3');
    expect(frame.regions[2]?.local_key).toBe('d_btn_right');

    expect(regionIndex['r1']?.dom_id).toBe('d_top');
    expect(regionIndex['r2']?.dom_id).toBe('d_btn_left');
    expect(regionIndex['r3']?.dom_id).toBe('d_btn_right');
  });
});
