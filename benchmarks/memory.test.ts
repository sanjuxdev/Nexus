import { describe, it, expect } from 'vitest';

describe('Memory Benchmarks', () => {
  it('should stay under 150MB baseline limit', () => {
    const mem = process.memoryUsage();
    const mbUsed = mem.heapUsed / 1024 / 1024;
    
    console.log(`Heap used: ${mbUsed.toFixed(2)} MB`);
    expect(mbUsed).toBeLessThan(150);
  });
});
