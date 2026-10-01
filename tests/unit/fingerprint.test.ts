import { describe, it, expect } from 'vitest';
import type { DomElementInfo, FrameInfo } from '@contracts/index.js';
import { computePageStateHash } from '../../extension/src/browser/state/fingerprint.js';

const frames: FrameInfo[] = [
  {
    frame_id: 'main',
    parent_frame_id: null,
    origin: 'http://localhost:5173',
    path: '/login',
    offset: [0, 0],
    accessible: true,
  },
];

function makeInteractiveElement(id: string, tag: string, name: string): DomElementInfo {
  return {
    dom_id: id,
    frame_id: 'main',
    origin: 'http://localhost:5173',
    tag,
    role: tag === 'button' ? 'button' : 'textbox',
    name,
    text: name,
    aria: { disabled: false },
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
}

describe('State Fingerprint (page_state_hash)', () => {
  it('computes identical hash for identical states', async () => {
    const el1 = makeInteractiveElement('d1', 'button', 'Login');
    const el2 = makeInteractiveElement('d2', 'input', 'Email');

    const hash1 = await computePageStateHash('http://localhost:5173', '/login', frames, [el1, el2], 0);
    const hash2 = await computePageStateHash('http://localhost:5173', '/login', frames, [el1, el2], 0);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });

  it('produces a different hash when an interactive element changes', async () => {
    const el1 = makeInteractiveElement('d1', 'button', 'Login');
    const el2 = makeInteractiveElement('d2', 'input', 'Email');

    const hashOriginal = await computePageStateHash('http://localhost:5173', '/login', frames, [el1], 0);
    const hashModified = await computePageStateHash('http://localhost:5173', '/login', frames, [el1, el2], 0);

    expect(hashOriginal).not.toBe(hashModified);
  });

  it('detects mutation in element state (e.g. disabled status)', async () => {
    const elActive = makeInteractiveElement('d1', 'button', 'Login');
    const elDisabled = { ...elActive, aria: { disabled: true } };

    const hashActive = await computePageStateHash('http://localhost:5173', '/login', frames, [elActive], 0);
    const hashDisabled = await computePageStateHash('http://localhost:5173', '/login', frames, [elDisabled], 0);

    expect(hashActive).not.toBe(hashDisabled);
  });
});
