import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { AttestedPayload } from '@contracts/index.js';
import { PlanResponseSchema } from '@contracts/index.js';
import { sendPlan } from '../../extension/src/network/gate.js';
import { sha256Hex } from '../../extension/src/security/sha256.js';

describe('FastAPI Reasoning Server Integration Test', () => {
  let serverProcess: ChildProcess | null = null;
  const serverPort = 8001;

  beforeAll(async () => {
    process.env.WXT_SERVER_URL = `http://localhost:${serverPort}`;
    // Check if server is already running on port 8000
    try {
      const res = await fetch(`http://localhost:${serverPort}/healthz`);
      if (res.ok) {
        return; // Already running
      }
    } catch {
      // Not running, spawn it
    }

    const pythonBin = path.resolve(__dirname, '../../server/.venv/bin/python');
    serverProcess = spawn(
      pythonBin,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(serverPort)],
      {
        cwd: path.resolve(__dirname, '../../server'),
        stdio: 'ignore',
      }
    );

    // Wait for server to be healthy
    let attempts = 30;
    while (attempts > 0) {
      try {
        const res = await fetch(`http://localhost:${serverPort}/healthz`);
        if (res.ok) break;
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 200));
      attempts--;
    }
  }, 15000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('connects to FastAPI /v1/plan, transmits attested payload, and receives validated PlanResponse', async () => {
    const context = {
      schema_version: '1.0',
      request_id: 'req_integration_01',
      task_id: 'task_01',
      step_index: 0,
      task: 'Sign into the portal',
      page: {
        origin: 'http://localhost:5173',
        path: '/login-demo.html',
        title: 'Portal Login',
        page_state_hash: 'hash_state_abc',
        viewport: { w: 1280, h: 800 },
        frame_ids: ['main'],
      },
      regions: [
        {
          region_id: 'r1',
          type: 'input',
          text: '<REDACTED_AADHAAR>',
          bbox: [10, 60, 200, 30],
          state: ['visible', 'enabled'],
          interactable: true,
          frame_id: 'main',
          sources: ['DOM'],
          confidence: 1,
          trust: 'untrusted',
        },
        {
          region_id: 'r2',
          type: 'input',
          text: '<REDACTED_PAN>',
          bbox: [10, 100, 200, 30],
          state: ['visible', 'enabled'],
          interactable: true,
          frame_id: 'main',
          sources: ['DOM'],
          confidence: 1,
          trust: 'untrusted',
        },
        {
          region_id: 'r3',
          type: 'button',
          text: 'Sign In',
          bbox: [10, 160, 160, 42],
          state: ['visible', 'enabled'],
          interactable: true,
          frame_id: 'main',
          sources: ['DOM'],
          confidence: 1,
          trust: 'untrusted',
        },
      ],
      capabilities: [],
      redactions: [
        { type: 'GOV_ID', count: 2 },
      ],
      image: null,
      history: [],
      flags: { injection_suspected_region_ids: [] },
    };

    const rawBody = JSON.stringify(context);
    const sha256 = await sha256Hex(rawBody);

    const attested: AttestedPayload = {
      request_id: 'req_integration_01',
      body: rawBody,
      sha256,
      issued_at: Date.now(),
    };

    const response = await sendPlan(attested);

    // Validate strictly against PlanResponseSchema
    const parsed = PlanResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);

    expect(response.status).toBe('action');
    expect(response.action).not.toBeNull();
    expect(response.action?.action).toBe('click');
    expect(response.action?.target?.region_id).toBe('r3');
    expect(response.action?.origin).toBe('http://localhost:5173');
    expect(response.usage.server_ms).toBeGreaterThanOrEqual(1);
    expect(response.usage.model).toBe('heuristic-planner-v1');
  });
});
