import { vi } from 'vitest';

// Test-only in-memory storage for Chrome extension session/local storage
const sessionStorageData: Record<string, any> = {};
const localStorageData: Record<string, any> = {};

export const mockChromeStorage = {
  session: {
    get: vi.fn(async (key?: string | string[] | Record<string, any>) => {
      if (!key) return { ...sessionStorageData };
      if (typeof key === 'string') {
        return { [key]: sessionStorageData[key] };
      }
      if (Array.isArray(key)) {
        const res: Record<string, any> = {};
        for (const k of key) res[k] = sessionStorageData[k];
        return res;
      }
      return { ...key, ...sessionStorageData };
    }),
    set: vi.fn(async (items: Record<string, any>) => {
      Object.assign(sessionStorageData, items);
    }),
    remove: vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) delete sessionStorageData[k];
    }),
    clear: vi.fn(async () => {
      for (const k in sessionStorageData) delete sessionStorageData[k];
    }),
  },
  local: {
    get: vi.fn(async (key?: string | string[]) => {
      if (!key) return { ...localStorageData };
      if (typeof key === 'string') return { [key]: localStorageData[key] };
      return {};
    }),
    set: vi.fn(async (items: Record<string, any>) => {
      Object.assign(localStorageData, items);
    }),
    remove: vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) delete localStorageData[k];
    }),
    clear: vi.fn(async () => {
      for (const k in localStorageData) delete localStorageData[k];
    }),
  },
};

// Set on global scope for Vitest unit test environment
// Note: We deliberately do not define chrome.runtime here so bus.ts correctly uses its in-memory Node bus
(globalThis as any).chrome = {
  ...(globalThis as any).chrome,
  storage: mockChromeStorage,
};
