import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { privacyStub } from '../../extension/src/privacy.stub.js';
import { sendPlan } from '../../extension/src/network/gate.js';
import {
  PlanResponseSchema,
  SanitizedContextSchema,
  AttestedPayloadSchema,
} from '../../contracts/ts/schemas.js';
import type { SanitizeRequest, PerceptionRegion } from '../../contracts/ts/index.js';

describe('Phase 1 E2E Flow: Perceive -> Redact -> Reason -> Act', () => {
  let serverProcess: ChildProcess | null = null;
  const serverPort = 8002;

  beforeAll(async () => {
    process.env.WXT_SERVER_URL = `http://localhost:${serverPort}`;
    // Check if server is already active
    try {
      const res = await fetch(`http://localhost:${serverPort}/healthz`);
      if (res.ok) return;
    } catch {
      // Spawn server
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

  it('verifies that login-demo.html contains Indian PII fields', () => {
    const demoPath = path.resolve(__dirname, '../../test-site/shared/login-demo.html');
    expect(fs.existsSync(demoPath)).toBe(true);

    const html = fs.readFileSync(demoPath, 'utf8');
    expect(html).toContain('id="email-input"');
    expect(html).toContain('id="aadhaar-input"');
    expect(html).toContain('id="pan-input"');
    expect(html).toContain('id="canvas-login"');
  });

  it('executes the full end-to-end loop without stubs or leaks', async () => {
    // Step 1: Perceive — simulated frame containing raw inputs extracted from DOM
    const rawAadhaar = '5489 1234 5674'; // Valid Verhoeff checksum
    const rawPan = 'ABCPE1234F'; // Valid PAN format with entity code P
    const rawEmail = 'scientist.guest@isro.demo.gov.in';
    const rawPhone = '+91 98765 43210';

    const regions: PerceptionRegion[] = [
      {
        region_id: 'r_email',
        local_key: 'd_email',
        source: ['DOM'],
        semantic_type: 'input',
        text: rawEmail,
        bbox: [100, 100, 300, 40],
        confidence: 1.0,
        visible: true,
        interactable: true,
        route: 'HIGH',
        sensitivity: 'pii',
        origin: 'http://localhost:5173',
        frame_id: 'main',
        page_state_hash: 'state_login_01',
        timestamp: Date.now(),
        dom_ref: { dom_id: 'd_email', role: 'textbox', tag: 'input' },
      },
      {
        region_id: 'r_aadhaar',
        local_key: 'd_aadhaar',
        source: ['DOM'],
        semantic_type: 'input',
        text: rawAadhaar,
        bbox: [100, 160, 300, 40],
        confidence: 1.0,
        visible: true,
        interactable: true,
        route: 'HIGH',
        sensitivity: 'pii',
        origin: 'http://localhost:5173',
        frame_id: 'main',
        page_state_hash: 'state_login_01',
        timestamp: Date.now(),
        dom_ref: { dom_id: 'd_aadhaar', role: 'textbox', tag: 'input' },
      },
      {
        region_id: 'r_pan',
        local_key: 'd_pan',
        source: ['DOM'],
        semantic_type: 'input',
        text: rawPan,
        bbox: [100, 220, 300, 40],
        confidence: 1.0,
        visible: true,
        interactable: true,
        route: 'HIGH',
        sensitivity: 'pii',
        origin: 'http://localhost:5173',
        frame_id: 'main',
        page_state_hash: 'state_login_01',
        timestamp: Date.now(),
        dom_ref: { dom_id: 'd_pan', role: 'textbox', tag: 'input' },
      },
      {
        region_id: 'r_phone',
        local_key: 'd_phone',
        source: ['DOM'],
        semantic_type: 'input',
        text: rawPhone,
        bbox: [100, 280, 300, 40],
        confidence: 1.0,
        visible: true,
        interactable: true,
        route: 'HIGH',
        sensitivity: 'pii',
        origin: 'http://localhost:5173',
        frame_id: 'main',
        page_state_hash: 'state_login_01',
        timestamp: Date.now(),
        dom_ref: { dom_id: 'd_phone', role: 'textbox', tag: 'input' },
      },
      {
        region_id: 'r_login_btn',
        local_key: 'd_btn',
        source: ['DOM'],
        semantic_type: 'button',
        text: 'Sign In',
        bbox: [100, 340, 160, 42],
        confidence: 1.0,
        visible: true,
        interactable: true,
        route: 'HIGH',
        sensitivity: 'none',
        origin: 'http://localhost:5173',
        frame_id: 'main',
        page_state_hash: 'state_login_01',
        timestamp: Date.now(),
        dom_ref: { dom_id: 'd_btn', role: 'button', tag: 'canvas' },
      },
    ];

    const sanitizeRequest: SanitizeRequest = {
      cycle_id: 'cycle_phase1_e2e',
      task: {
        task_id: 'task_phase1',
        task_text: 'Authenticate into employee portal',
        allowed_actions: ['click', 'type', 'fill_secret'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'frame_phase1',
        cycle_id: 'cycle_phase1_e2e',
        page_state_hash: 'state_login_01',
        origin: 'http://localhost:5173',
        regions,
        ocr_tokens: [],
        faces: [],
        dom: {
          snapshot_id: 'snap_phase1',
          url_origin: 'http://localhost:5173',
          url_path: '/login-demo.html',
          frames: [
            {
              frame_id: 'main',
              parent_frame_id: null,
              origin: 'http://localhost:5173',
              path: '/login-demo.html',
              offset: [0, 0],
              accessible: true,
            },
          ],
          elements: [],
          viewport: { w: 1280, h: 800 },
          dpr: 1,
          scroll: { x: 0, y: 0 },
          page_state_hash: 'state_login_01',
          ts: Date.now(),
        },
        capture: null,
        ts: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    // Step 2 & 3: Detect PII and Redact locally
    const sanitizeResult = await privacyStub.sanitize(sanitizeRequest);
    expect(sanitizeResult.verdict).toBe('SAFE');
    expect(sanitizeResult.attested).not.toBeNull();
    expect(sanitizeResult.detections.length).toBeGreaterThanOrEqual(4);

    const attested = sanitizeResult.attested!;
    AttestedPayloadSchema.parse(attested);

    // CRITICAL SECURITY ASSERTION: Zero raw PII on the wire
    expect(attested.body).not.toContain(rawAadhaar);
    expect(attested.body).not.toContain('548912345674');
    expect(attested.body).not.toContain(rawPan);
    expect(attested.body).not.toContain(rawEmail);
    expect(attested.body).toContain('<REDACTED_AADHAAR>');
    expect(attested.body).toContain('<REDACTED_PAN>');
    expect(attested.body).toContain('<EMAIL>');

    // Step 4: Validate Sanitized Context schema
    const parsedContext = JSON.parse(attested.body);
    SanitizedContextSchema.parse(parsedContext);

    // Step 5: Transmit to FastAPI Reasoning Server and receive action
    const planResponse = await sendPlan(attested);
    PlanResponseSchema.parse(planResponse);

    expect(planResponse.status).toBe('action');
    expect(planResponse.action).not.toBeNull();
    expect(planResponse.action?.action).toBe('click');
    expect(planResponse.action?.target?.region_id).toBe('r_login_btn');
    expect(planResponse.usage.server_ms).toBeGreaterThanOrEqual(1);
    expect(planResponse.usage.model).toBe('heuristic-planner-v1');
  });
});
