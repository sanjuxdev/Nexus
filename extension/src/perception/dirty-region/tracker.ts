import type { DirtyEvent } from '@contracts/index.js';

let pendingDirtyEvents: DirtyEvent[] = [];

export const dirtyTracker = {
  add(event: DirtyEvent): void {
    pendingDirtyEvents.push(event);
  },

  consume(): DirtyEvent[] {
    const events = [...pendingDirtyEvents];
    pendingDirtyEvents = [];
    return events;
  },

  clear(): void {
    pendingDirtyEvents = [];
  },
};
