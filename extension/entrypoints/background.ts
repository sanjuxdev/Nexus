import { defineBackground } from 'wxt/sandbox';
import { bus } from '@contracts/index.js';
import { getUiState, privacyController, wakePrivacyLoop } from '../src/background/privacy-controller.js';
import { dirtyTracker } from '../src/perception/dirty-region/tracker.js';
import { telemetrySink } from '../src/telemetry/sink.js';

export default defineBackground(() => {
  // Top-level synchronous message listener registration (MV3 requirement)
  bus.on('privacy/start', async (payload, sender) => {
    let tabId = payload.tab_id;

    if (!tabId && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        const webTabs = allTabs.filter(
          (t) =>
            t.id &&
            t.url &&
            !t.url.startsWith('chrome-extension://') &&
            !t.url.startsWith('chrome://') &&
            !t.url.startsWith('chrome-error://') &&
            t.url !== 'about:blank'
        );
        let activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const candidateActive = activeTabs?.find((t) => t.id && t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
        tabId = candidateActive?.id || webTabs.find((t) => t.active)?.id || webTabs[0]?.id;
      } catch (err) {
        console.warn('[SW] Could not query active tab:', err);
      }
    }

    console.log('[SW] Starting protection on tabId:', tabId);
    const taskId = await privacyController.startProtection(tabId || 0);
    return { task_id: taskId };
  });

  bus.on('privacy/stop', async (payload) => {
    await privacyController.stopProtection(payload.task_id);
    return { cancelled: true };
  });

  bus.on('task/confirm', async (payload) => {
    // Left for schema compatibility; not functionally used in privacy-only mode
    return { acknowledged: true };
  });

  bus.on('ui/get-state', async () => {
    return getUiState();
  });

  bus.on('dom/dirty', async (payload) => {
    dirtyTracker.add(payload as any);
    // Wake the privacy loop immediately so masks are refreshed after scroll/mutation
    wakePrivacyLoop();
    return { received: true };
  });

  bus.on('telemetry/event', async (payload) => {
    await telemetrySink.record(payload);
    return { recorded: true };
  });
});
