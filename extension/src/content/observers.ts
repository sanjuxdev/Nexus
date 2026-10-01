import type { DirtyEvent } from '@contracts/index.js';
import { bus } from '@contracts/index.js';
import { markDirty } from '../perception/dom/snapshot.js';

let mutationObserver: MutationObserver | null = null;
let lastScrollY = 0;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let dirtyTimeout: ReturnType<typeof setTimeout> | null = null;
let batchedBBox: [number, number, number, number] | null = null;
let activeScrollListener: (() => void) | null = null;

export function stopDomObservers() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (scrollTimeout) clearTimeout(scrollTimeout);
  if (dirtyTimeout) clearTimeout(dirtyTimeout);
  if (activeScrollListener && typeof window !== 'undefined') {
    window.removeEventListener('scroll', activeScrollListener);
    activeScrollListener = null;
  }
}

export function startDomObservers(frameId = 'main'): () => void {
  if (typeof document === 'undefined') return () => {};

  stopDomObservers(); // Duplicate-observer prevention

  mutationObserver = new MutationObserver((mutations) => {
    let hasMeaningful = false;

    for (const m of mutations) {
      let target = m.target as HTMLElement;
      if (m.type === 'characterData') {
        target = m.target.parentElement as HTMLElement;
      }
      
      if (!target || !target.closest) continue;

      // Protection against extension-generated mutation loops
      if (target.closest('[data-agent-ui]') || target.id === '__sih_agent_ui_host__') {
        continue;
      }
      
      if (m.type === 'childList') {
        let onlyExtensionNodes = true;
        if (m.addedNodes.length === 0 && m.removedNodes.length === 0) {
          onlyExtensionNodes = false;
        }
        
        m.addedNodes.forEach(n => {
          const el = n as HTMLElement;
          if (el.nodeType !== Node.ELEMENT_NODE) {
            onlyExtensionNodes = false;
            return;
          }
          if (el.id !== '__sih_agent_ui_host__' && !el.hasAttribute?.('data-agent-ui')) {
            onlyExtensionNodes = false;
            markDirty(el);
          }
        });
        
        m.removedNodes.forEach(n => {
          const el = n as HTMLElement;
          if (el.nodeType !== Node.ELEMENT_NODE) {
            onlyExtensionNodes = false;
            return;
          }
          if (el.id !== '__sih_agent_ui_host__' && !el.hasAttribute?.('data-agent-ui')) {
            onlyExtensionNodes = false;
          }
        });

        if (onlyExtensionNodes) {
          continue;
        }
      }

      markDirty(target);

      hasMeaningful = true;

      if (!batchedBBox && target.getBoundingClientRect) {
        const rect = target.getBoundingClientRect();
        batchedBBox = [rect.left, rect.top, rect.width, rect.height];
      }
    }

    if (!hasMeaningful) return;

    if (!dirtyTimeout) {
      dirtyTimeout = setTimeout(() => {
        const event: DirtyEvent = {
          reason: 'mutation',
          bbox: batchedBBox,
          frame_id: frameId,
          ts: Date.now(),
        };
        bus.send('dom/dirty', event).catch(() => {});
        batchedBBox = null;
        dirtyTimeout = null;
      }, 100); // Debounce
    }
  });

  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled'],
    characterData: true // Required for text changes
  });

  const onScroll = () => {
    if (Math.abs(window.scrollY - lastScrollY) < 32) return;
    lastScrollY = window.scrollY;

    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const event: DirtyEvent = {
        reason: 'scroll',
        bbox: null,
        frame_id: frameId,
        ts: Date.now(),
      };
      bus.send('dom/dirty', event).catch(() => {});
    }, 100);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  activeScrollListener = onScroll;

  return () => {
    stopDomObservers();
  };
}
