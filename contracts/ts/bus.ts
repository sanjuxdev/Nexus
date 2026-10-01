import type { BusResponse, MessageMap, MessageType } from './messages.js';
import { stageError } from './common.js';

function getChrome(): typeof chrome | undefined {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    return chrome;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).chrome?.runtime) {
    return (globalThis as any).chrome;
  }
  return undefined;
}

type Handler<T extends MessageType> = (
  payload: MessageMap[T]['payload'],
  sender?: any
) => Promise<MessageMap[T]['response']> | MessageMap[T]['response'];

// Registry for handlers in extension realm
const chromeHandlers = new Map<string, Array<Handler<any>>>();
let globalListenerAttached = false;

function ensureGlobalMessageListener(ext: typeof chrome) {
  if (globalListenerAttached) return;
  globalListenerAttached = true;

  ext.runtime.onMessage.addListener(
    (message: any, sender: any, sendResponse: (res: BusResponse<any>) => void) => {
      if (!message || typeof message.type !== 'string') {
        return false;
      }

      const handlers = chromeHandlers.get(message.type);
      if (handlers && handlers.length > 0) {
        Promise.resolve()
          .then(() => handlers[0]!(message.payload, sender))
          .then((data) => {
            sendResponse({ ok: true, data });
          })
          .catch((err) => {
            const error =
              err?.code && err?.stage
                ? err
                : stageError('INTERNAL', 'dom', err?.message || String(err));
            sendResponse({ ok: false, error });
          });
        return true; // Keep message channel open for asynchronous sendResponse
      }

      return false;
    }
  );
}

// In-memory bus fallback for testing/node environments
const localHandlers = new Map<string, Array<(payload: any) => Promise<any> | any>>();

export const bus = {
  /**
   * Send a typed message across realms (or locally if in test/node).
   */
  async send<T extends MessageType>(
    type: T,
    payload: MessageMap[T]['payload'],
    options?: { tabId?: number; frameId?: number; timeoutMs?: number }
  ): Promise<BusResponse<MessageMap[T]['response']>> {
    const message = { type, payload };
    const ext = getChrome();
    const timeoutMs = options?.timeoutMs || (type === 'vision/perceive' ? 10000 : 4500);

    // 1. Chrome extension environment
    if (ext && ext.runtime?.sendMessage) {
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              error: stageError('TIMEOUT', 'dom', `Message "${type}" timed out after ${timeoutMs}ms`),
            });
          }
        }, timeoutMs);

        try {
          const callback = (res: BusResponse<MessageMap[T]['response']> | undefined) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (ext.runtime.lastError) {
              resolve({
                ok: false,
                error: stageError(
                  'INTERNAL',
                  'dom',
                  ext.runtime.lastError.message || 'Unknown runtime error'
                ),
              });
              return;
            }
            if (!res) {
              resolve({
                ok: false,
                error: stageError('INTERNAL', 'dom', `No response from handler for message "${type}"`),
              });
              return;
            }
            resolve(res);
          };

          if (options?.tabId && options.tabId > 0 && ext.tabs?.sendMessage) {
            if (options.frameId !== undefined) {
              ext.tabs.sendMessage(options.tabId, message, { frameId: options.frameId }, callback);
            } else {
              ext.tabs.sendMessage(options.tabId, message, callback);
            }
          } else {
            ext.runtime.sendMessage(message, callback);
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({
              ok: false,
              error: stageError('INTERNAL', 'dom', err instanceof Error ? err.message : String(err)),
            });
          }
        }
      });
    }

    // 2. Node / test environment fallback
    const handlers = localHandlers.get(type);
    if (!handlers || handlers.length === 0) {
      return {
        ok: false,
        error: stageError('INTERNAL', 'dom', `No local handler registered for "${type}"`),
      };
    }

    try {
      const data = await handlers[0]!(payload);
      return { ok: true, data };
    } catch (err: any) {
      return {
        ok: false,
        error: err.code && err.stage ? err : stageError('INTERNAL', 'dom', err.message || String(err)),
      };
    }
  },

  /**
   * Register a typed message listener.
   */
  on<T extends MessageType>(type: T, handler: Handler<T>): () => void {
    const ext = getChrome();
    if (ext && ext.runtime?.onMessage) {
      ensureGlobalMessageListener(ext);

      const list = chromeHandlers.get(type) || [];
      list.push(handler);
      chromeHandlers.set(type, list);

      return () => {
        const existing = chromeHandlers.get(type) || [];
        const filtered = existing.filter((h) => h !== handler);
        if (filtered.length > 0) {
          chromeHandlers.set(type, filtered);
        } else {
          chromeHandlers.delete(type);
        }
      };
    }

    // Node / test environment
    const list = localHandlers.get(type) || [];
    list.push(handler);
    localHandlers.set(type, list);

    return () => {
      const existing = localHandlers.get(type) || [];
      const filtered = existing.filter((h) => h !== handler);
      if (filtered.length > 0) {
        localHandlers.set(type, filtered);
      } else {
        localHandlers.delete(type);
      }
    };
  },

  /**
   * Clears all local test handlers (for tests).
   */
  _clearLocalHandlers() {
    localHandlers.clear();
    chromeHandlers.clear();
  },
};
