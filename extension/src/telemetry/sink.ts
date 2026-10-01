import type { StageName, TelemetryEvent } from '@contracts/index.js';
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'sih26171_telemetry';
const DB_VERSION = 1;
const STORE_NAME = 'events';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('by_cycle', 'cycle_id');
          store.createIndex('by_stage', 'stage');
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Validates that metadata adheres to Invariant I11:
 * No raw text, only numbers, enums, IDs, strings <= 40 chars without spaces.
 */
function sanitizeMeta(meta?: Record<string, string | number | boolean>): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'number' || typeof v === 'boolean') {
      clean[k] = v;
    } else if (typeof v === 'string') {
      if (v.length <= 40 && !v.includes(' ')) {
        clean[k] = v;
      } else {
        clean[k] = '[REDACTED_BY_I11]';
      }
    }
  }
  return clean;
}

export const telemetrySink = {
  async record(event: TelemetryEvent): Promise<void> {
    const cleanEvent: TelemetryEvent = {
      ...event,
      duration_ms: Math.round(event.duration_ms * 1000) / 1000,
      meta: sanitizeMeta(event.meta),
    };

    const db = await getDb();
    if (db) {
      try {
        await db.add(STORE_NAME, cleanEvent);
      } catch (err) {
        console.warn('Telemetry DB write failed:', err);
      }
    }
  },

  async getCycleEvents(cycleId: string): Promise<TelemetryEvent[]> {
    const db = await getDb();
    if (!db) return [];
    return db.getAllFromIndex(STORE_NAME, 'by_cycle', cycleId);
  },
};
