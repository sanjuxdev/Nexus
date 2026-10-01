import type { AttestedPayload, PlanResponse } from '@contracts/index.js';
import { PlanResponseSchema, stageError } from '@contracts/index.js';
import { sha256Hex } from '../security/sha256.js';
import { flags } from '../config/flags.js';

export function getServerUrl(): string {
  const proc = typeof globalThis !== 'undefined' ? (globalThis as any).process : undefined;
  return (proc && proc.env?.WXT_SERVER_URL) || 'http://localhost:8000';
}

function getApiKey(): string {
  const proc = typeof globalThis !== 'undefined' ? (globalThis as any).process : undefined;
  return (proc && proc.env?.WXT_API_KEY) || 'dev-key';
}

export async function sendPlan(attested: AttestedPayload): Promise<PlanResponse> {
  // Invariant I5: Verify SHA-256 digest of payload body before sending
  const calculatedDigest = await sha256Hex(attested.body);
  if (calculatedDigest !== attested.sha256) {
    throw stageError('PRIVACY_BLOCK', 'network', 'digest mismatch: body was altered after attestation');
  }

  const serverUrl = getServerUrl();
  const apiKey = getApiKey();

  // Attempt real network call to FastAPI server
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`${serverUrl}/v1/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: attested.body, // Send body as-is (never re-serialize)
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const json = await res.json();
    return PlanResponseSchema.parse(json);
  } catch (err: any) {
    // If mock mode is enabled and server is offline, return deterministic mock action
    if (flags.server === 'mock') {
      const parsedContext = JSON.parse(attested.body);
      const origin = parsedContext.page.origin;
      const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');

      if (!isLocal) {
        return {
          request_id: attested.request_id,
          status: 'fail',
          message: 'Mock planner is not allowed to generate uncontrolled actions on real websites. Please start the real planner server.',
          action: null,
          usage: { server_ms: 0, model: 'mock-planner' },
        };
      }

      const task = (parsedContext.task || '').toLowerCase();
      
      let mockAction: any = {
        action_id: `act_${Date.now()}`,
        request_id: attested.request_id,
        action: 'click',
        params: null,
        capability: null,
        origin: origin,
        frame_id: parsedContext.page.frame_ids?.[0] || 'main',
        page_state_hash: parsedContext.page.page_state_hash,
        rationale: 'Mock planner: default fallback',
      };

      if (task.includes('scroll')) {
        mockAction.action = 'scroll';
        mockAction.params = { direction: task.includes('up') ? 'up' : 'down', amount: 300 };
        mockAction.rationale = 'Mock planner: inferred scroll intent';
      } else if (task.includes('type') || task.includes('enter') || task.includes('fill')) {
        const inputRegion = parsedContext.regions?.find((r: any) => r.type === 'input' || r.type === 'textarea');
        if (inputRegion) {
          mockAction.action = 'type';
          mockAction.target = { region_id: inputRegion.region_id };
          mockAction.params = { text: 'mock input' };
          mockAction.rationale = 'Mock planner: inferred type intent';
        }
      } else if (task.includes('back')) {
        mockAction.action = 'back';
        mockAction.rationale = 'Mock planner: inferred back intent';
      } else {
        const buttonRegion = parsedContext.regions?.find(
          (r: any) => r.type === 'button' || (r.text && r.text.toLowerCase().includes('sign in') || r.text?.toLowerCase().includes('login'))
        );
        const targetRegionId = buttonRegion ? buttonRegion.region_id : (parsedContext.regions?.[0]?.region_id || 'r1');
        mockAction.target = { region_id: targetRegionId };
        mockAction.rationale = 'Mock planner: inferred click on button';
      }

      return {
        request_id: attested.request_id,
        status: 'action',
        action: mockAction,
        message: 'Mock plan response generated safely',
        usage: {
          server_ms: 10,
          model: 'mock-planner',
        },
      };
    }

    throw stageError(
      'SERVER_UNAVAILABLE',
      'network',
      `Failed to contact server at ${serverUrl}: ${err.message || String(err)}`,
      true
    );
  }
}
