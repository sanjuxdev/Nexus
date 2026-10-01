import type { TaskSession } from '@contracts/index.js';

let inMemorySession: TaskSession | null = null;
const SESSION_KEY = '__sih_task_session__';

export const sessionStore = {
  async save(session: TaskSession): Promise<void> {
    inMemorySession = session;
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        await chrome.storage.session.set({ [SESSION_KEY]: session });
      } catch (err) {
        console.warn('Failed to persist session to chrome.storage.session:', err);
      }
    }
  },

  async load(): Promise<TaskSession | null> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const res = await chrome.storage.session.get(SESSION_KEY);
        if (res && res[SESSION_KEY]) {
          inMemorySession = res[SESSION_KEY] as TaskSession;
          return inMemorySession;
        }
      } catch (err) {
        console.warn('Failed to load session from chrome.storage.session:', err);
      }
    }
    return inMemorySession;
  },

  async clear(): Promise<void> {
    inMemorySession = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        await chrome.storage.session.remove(SESSION_KEY);
      } catch {
        // Ignored
      }
    }
  },
};
