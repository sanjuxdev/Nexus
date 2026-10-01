import { defineContentScript } from 'wxt/sandbox';
import { bus } from '@contracts/index.js';
import { extractDomSnapshot } from '../src/perception/dom/snapshot.js';
import { startDomObservers } from '../src/content/observers.js';
import { elementRegistry } from '../src/content/registry.js';
import { executeAction } from '../src/actions/executor/index.js';
import { isElementOccluded, isElementVisible } from '../src/perception/dom/visibility.js';
import { mapDomToSemanticType } from '../src/perception/dom/to-regions.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    const isTop = typeof window !== 'undefined' && window.self === window.top;
    const frameId = isTop ? 'main' : `frame_${Math.random().toString(36).substring(2, 7)}`;

    // Start DOM mutation & scroll observers
    startDomObservers(frameId);

    // Synchronous top-level bus listeners
    bus.on('dom/snapshot', async () => {
      return extractDomSnapshot(frameId);
    });

    bus.on('dom/fingerprint', async () => {
      const snap = await extractDomSnapshot(frameId);
      return {
        page_state_hash: snap.page_state_hash,
        origin: snap.url_origin,
        frame_id: frameId,
      };
    });

    bus.on('registry/set', async (payload) => {
      elementRegistry.setRegionMapping(payload.mapping);
      return { applied: true };
    });

    bus.on('action/resolve-target', async (payload) => {
      const el = elementRegistry.getByRegionId(payload.region_id);
      if (!el || !el.isConnected) {
        return {
          exists: false,
          visible: false,
          interactable: false,
          occluded: false,
          bbox: [0, 0, 0, 0],
          origin: window.location.origin,
          frame_id: frameId,
          semantic_type: 'unknown',
          input_type: null,
          is_password: false,
        };
      }

      const rect = el.getBoundingClientRect();
      const visible = isElementVisible(el);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const occluded = isElementOccluded(el, cx, cy);
      const interactable = visible && !(el as any).disabled && !occluded;

      const tag = el.tagName.toLowerCase();
      let inputType: string | null = null;
      let isPassword = false;

      if (tag === 'input') {
        inputType = ((el as HTMLInputElement).type || 'text').toLowerCase();
        isPassword = inputType === 'password';
      }

      return {
        exists: true,
        visible,
        interactable,
        occluded,
        bbox: [
          Math.round(rect.left),
          Math.round(rect.top),
          Math.round(rect.width),
          Math.round(rect.height),
        ],
        origin: window.location.origin,
        frame_id: frameId,
        semantic_type: mapDomToSemanticType({
          dom_id: '',
          frame_id: frameId,
          origin: window.location.origin,
          tag,
          role: el.getAttribute('role'),
          name: null,
          text: el.textContent || '',
          aria: {},
          bbox: [0, 0, 0, 0],
          visible,
          in_viewport: true,
          occluded,
          interactable,
          rendering: 'html',
          has_bg_image: false,
          handlers_hint: false,
          parent_dom_id: null,
        }),
        input_type: inputType,
        is_password: isPassword,
      };
    });

    bus.on('action/execute', async (payload) => {
      return executeAction(payload.action, payload.resolved_secret);
    });

    bus.on('test/inject-dom-change', async (payload) => {
      const div = document.createElement('div');
      div.innerHTML = payload.html;
      document.body.appendChild(div);
      return { injected: true };
    });
  },
});
