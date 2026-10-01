import type { CaptureMeta } from '@contracts/index.js';

const MOCK_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let lastCaptureTime = 0;
const MIN_INTERVAL_MS = 800; // Rate limit ~1.25 calls/s (safely below Chrome's 2 calls/s quota)

export async function captureScreenshot(
  tabId: number,
  pageStateHash: string,
  tabViewport?: { w: number; h: number },
  tabDpr?: number
): Promise<{ dataUrl: string; meta: CaptureMeta }> {
  const now = Date.now();
  const elapsed = now - lastCaptureTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastCaptureTime = Date.now();

  const captureId = `cap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (typeof chrome !== 'undefined' && chrome.tabs?.captureVisibleTab) {
    let windowId: number | undefined;
    if (tabId > 0 && chrome.tabs?.get) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.windowId) {
          windowId = tab.windowId;
        }
      } catch (err) {
        console.warn('[Screenshot] Failed to query tab for windowId:', err);
      }
    }

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (val: { dataUrl: string; meta: CaptureMeta }) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(fallbackTimer);
          resolve(val);
        }
      };

      // Fallback timer: Never let captureVisibleTab hang the execution pipeline
      const fallbackTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[Screenshot] captureVisibleTab timed out after 1800ms');
          resolve({ dataUrl: MOCK_DATA_URL, meta });
        }
      }, 1800);

      const dpr = tabDpr || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
      const w = tabViewport?.w || (typeof window !== 'undefined' ? window.innerWidth : 1280);
      const h = tabViewport?.h || (typeof window !== 'undefined' ? window.innerHeight : 800);

      const meta: CaptureMeta = {
        capture_id: captureId,
        page_state_hash: pageStateHash,
        dpr,
        viewport: { w, h },
        scroll: {
          x: typeof window !== 'undefined' ? window.scrollX : 0,
          y: typeof window !== 'undefined' ? window.scrollY : 0,
        },
        image: { w: Math.round(w * dpr), h: Math.round(h * dpr) },
        ts: Date.now(),
      };

      const handleCapture = (dataUrl?: string) => {
        const lastErrorMsg = chrome.runtime.lastError?.message;
        if (lastErrorMsg || !dataUrl) {
          if (lastErrorMsg?.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
            // Quota hit: wait 650ms and try once more before fallback
            setTimeout(() => {
              try {
                const retryCallback = (retryUrl?: string) => {
                  lastCaptureTime = Date.now();
                  if (retryUrl && !chrome.runtime.lastError) {
                    safeResolve({ dataUrl: retryUrl, meta });
                  } else {
                    if (!resolved) {
                      resolved = true;
                      clearTimeout(fallbackTimer);
                      console.warn('[Screenshot] captureVisibleTab failed after retry: ' + (chrome.runtime.lastError?.message || 'No dataUrl'));
                      resolve({ dataUrl: MOCK_DATA_URL, meta });
                    }
                  }
                };
                if (windowId !== undefined) {
                  chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, retryCallback);
                } else {
                  chrome.tabs.captureVisibleTab({ format: 'png' }, retryCallback);
                }
              } catch (e) {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(fallbackTimer);
                  console.warn('[Screenshot] captureVisibleTab threw an exception during retry: ' + String(e));
                  resolve({ dataUrl: MOCK_DATA_URL, meta });
                }
              }
            }, 650);
            return;
          }
          if (!resolved) {
            resolved = true;
            clearTimeout(fallbackTimer);
            console.warn('[Screenshot] captureVisibleTab failed:', lastErrorMsg);
            // Don't throw inside a callback; resolve with a mock so the pipeline doesn't hang
            resolve({ dataUrl: MOCK_DATA_URL, meta });
          }
          return;
        }
        safeResolve({ dataUrl, meta });
      };

      try {
        if (windowId !== undefined) {
          chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, handleCapture);
        } else {
          chrome.tabs.captureVisibleTab({ format: 'png' }, handleCapture);
        }
      } catch (err) {
        console.warn('[Screenshot] captureVisibleTab threw:', err);
        safeResolve({ dataUrl: MOCK_DATA_URL, meta });
      }
    });
  }

  // Fallback for tests or environments without tabs permission
  const meta: CaptureMeta = {
    capture_id: captureId,
    page_state_hash: pageStateHash,
    dpr: 1,
    viewport: { w: 1280, h: 800 },
    scroll: { x: 0, y: 0 },
    image: { w: 1280, h: 800 },
    ts: Date.now(),
  };

  return { dataUrl: MOCK_DATA_URL, meta };
}
