import type { StageName } from '@contracts/index.js';
import { telemetrySink } from './sink.js';

export class Span {
  private startMs: number;

  constructor(
    public readonly stage: StageName,
    public readonly cycleId: string
  ) {
    this.startMs = performance.now();
  }

  async end(meta?: Record<string, string | number | boolean>): Promise<number> {
    const endMs = performance.now();
    const duration_ms = Math.round((endMs - this.startMs) * 1000) / 1000;

    await telemetrySink.record({
      ts: Date.now(),
      cycle_id: this.cycleId,
      stage: this.stage,
      duration_ms,
      meta,
    });

    return duration_ms;
  }
}

export function startSpan(stage: StageName, cycleId: string): Span {
  return new Span(stage, cycleId);
}
