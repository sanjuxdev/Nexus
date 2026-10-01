import { describe, it, expect } from 'vitest';
import type { AttestedPayload } from '@contracts/index.js';
import { sendPlan } from '../../extension/src/network/gate.js';
import { sha256Hex } from '../../extension/src/security/sha256.js';

describe('Network Gate & Attestation Security (Invariant I5)', () => {
  it('accepts and processes an untampered attested payload', async () => {
    const validBody = JSON.stringify({
      schema_version: '1.0',
      request_id: 'req_test',
      task: 'demo',
      page: { origin: 'http://localhost:5173', path: '/', page_state_hash: '123', viewport: { w: 100, h: 100 }, frame_ids: ['main'] },
      regions: [{ region_id: 'r1', type: 'button', text: 'Login', bbox: [0, 0, 10, 10], state: ['visible'], interactable: true, frame_id: 'main', sources: ['DOM'], confidence: 1, trust: 'untrusted' }],
      capabilities: [],
      redactions: [],
      image: null,
      history: [],
      flags: { injection_suspected_region_ids: [] },
    });

    const sha256 = await sha256Hex(validBody);
    const attested: AttestedPayload = {
      request_id: 'req_test',
      body: validBody,
      sha256,
      issued_at: Date.now(),
    };

    const resp = await sendPlan(attested);
    expect(resp.status).toBe('action');
    expect(resp.action?.target?.region_id).toBe('r1');
  });

  it('rejects tampered payload body where SHA-256 digest does not match (I5)', async () => {
    const originalBody = JSON.stringify({ valid: true });
    const originalDigest = await sha256Hex(originalBody);

    const tamperedPayload: AttestedPayload = {
      request_id: 'req_tampered',
      body: JSON.stringify({ valid: false, injected: 'attack' }), // Body modified after attestation!
      sha256: originalDigest,
      issued_at: Date.now(),
    };

    await expect(sendPlan(tamperedPayload)).rejects.toMatchObject({
      code: 'PRIVACY_BLOCK',
      stage: 'network',
    });
  });

  it('enforces that fetch is never called outside extension/src/network/', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const srcDir = path.resolve(__dirname, '../../extension/src');

    function checkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'network') continue;
          checkDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          expect(content.match(/\bfetch\s*\(/g)).toBeNull();
        }
      }
    }

    checkDir(srcDir);
  });
});
