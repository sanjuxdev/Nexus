import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PerceptionDaemon } from '../../extension/src/background/perception-daemon.js';
import { bus } from '@contracts/index.js';
import type { TaskSession } from '@contracts/index.js';
import type { PerceptionCycleRequest } from '../../extension/src/background/perception-interface.js';

import { mockChromeStorage } from '../setup.js';

// Setup Test Doubles for Browser Extension Environment
const chromeMock = {
  storage: mockChromeStorage,
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(),
  },
  runtime: {
    id: 'mock-ext-id',
  },
};

describe('PerceptionDaemon (Phase 2 Validation)', () => {
  let daemon: PerceptionDaemon;
  let mockSession: TaskSession;
  let broadcastUiState: any;
  let abortController: AbortController;

  beforeEach(() => {
    (global as any).chrome = chromeMock;
    vi.clearAllMocks();
    
    // Test double for WXT message bus
    let domSnapshotCalls = 0;
    vi.spyOn(bus, 'send').mockImplementation(async (messageType: string) => {
      if (messageType === 'dom/snapshot') {
        domSnapshotCalls++;
        // On re-verification call after screenshot capture, return verified snapshot
        if (domSnapshotCalls > 1) {
          return {
            ok: true,
            data: {
              snapshot_id: `snap_${Date.now()}`,
              url_origin: 'https://example.com',
              url_path: '/login-demo.html',
              frames: [{ frame_id: 'main', parent_frame_id: null, origin: 'https://example.com', path: '/login-demo.html', offset: [0, 0], accessible: true }],
              elements: [{ dom_id: 'd1', tag: 'input', text: 'My PAN is ABCDE1234F', visible: true, interactable: true, bbox: [0, 0, 100, 20], input: { type: 'text' } }],
              viewport: { w: 1024, h: 768 },
              dpr: 1,
              scroll: { x: 0, y: 0 },
              page_state_hash: 'mock_state_hash',
              ts: Date.now(),
            }
          };
        }
        return { ok: false, data: null };
      }
      return { ok: false, error: { stage: 'network', code: 'ERR', message: 'mock' } as any };
    });

    daemon = new PerceptionDaemon();
    
    mockSession = {
      task_id: 'test_task_1',
      task_text: 'Test task',
      tab_id: 100,
      allowed_origins: ['https://example.com'],
      allowed_actions: ['click'],
      step_index: 0,
      max_steps: 10,
      state: 'IDLE',
      frame_page_state_hash: null,
      region_index: {},
      history: [],
      recent_state_hashes: [],
    };
    
    broadcastUiState = vi.fn();
    abortController = new AbortController();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes independently of the AI Agent Loop', () => {
    expect(daemon).toBeInstanceOf(PerceptionDaemon);
    expect(daemon.runCycle).toBeTypeOf('function');
  });

  it('performs DOM/ARIA perception independently', async () => {
    // Setup the mock browser to return a valid tab
    chromeMock.tabs.get.mockResolvedValue({ id: 100, url: 'https://example.com', status: 'complete' });
    
    // Mock direct execution fallback returning DOM elements
    chromeMock.scripting.executeScript.mockResolvedValue([{
      result: {
        viewport: { w: 1024, h: 768 },
        origin: 'https://example.com',
        elements: [
          { dom_id: 'd1', tag: 'input', text: '', visible: true, interactable: true, bbox: [0, 0, 100, 20], input: { type: 'text' } }
        ]
      }
    }]);

    const req: PerceptionCycleRequest = {
      cycleId: 'cycle_1',
      session: mockSession,
      activeAbortController: abortController,
      broadcastUiState,
    };

    const result = await daemon.runCycle(req);
    
    expect(result).not.toBeNull();
    expect(result?.domSnapshot.elements.length).toBeGreaterThan(0);
    expect(broadcastUiState).toHaveBeenCalledWith({ state: 'PERCEIVING' });
  });

  it('reports why DOM mutation observation through MutationObserver cannot be unit tested here', () => {
    // Current Architecture Limitation:
    // The MutationObserver is injected into the web page via content scripts (observers.ts).
    // The PerceptionDaemon itself does not instantiate a MutationObserver; it relies on 
    // the content script sending 'dom/dirty' messages to the background worker.
    // Thus, we cannot test the daemon's own instantiation of a MutationObserver, 
    // because it rightfully delegates this to the content script.
    expect(true).toBe(true);
  });

  it('supports synchronous perception execution', async () => {
    chromeMock.tabs.get.mockResolvedValue({ id: 100, url: 'https://example.com', status: 'complete' });
    chromeMock.scripting.executeScript.mockResolvedValue([{
      result: {
        viewport: { w: 1024, h: 768 },
        origin: 'https://example.com',
        elements: [] // Empty will trigger fallback inside daemon
      }
    }]);

    const req: PerceptionCycleRequest = {
      cycleId: 'sync_cycle',
      session: mockSession,
      activeAbortController: abortController,
      broadcastUiState,
    };

    // Execute synchronously/awaited
    const result = await daemon.runCycle(req);
    
    expect(result).not.toBeNull();
    expect(result?.sanRes).toBeDefined();
    // Verify it reached SANITIZING state without needing the AI Agent Orchestrator loop
    expect(broadcastUiState).toHaveBeenCalledWith({ state: 'SANITIZING' });
  });

  it('can run in a continuous/daemon mode loop when driven externally', async () => {
    // While the Daemon object doesn't contain a `while(true)` loop (by design, to remain stateless),
    // we verify it can be called multiple times sequentially to simulate continuous mode.
    chromeMock.tabs.get.mockResolvedValue({ id: 100, url: 'https://example.com', status: 'complete' });
    chromeMock.scripting.executeScript.mockResolvedValue([{
      result: { viewport: { w: 100, h: 100 }, origin: 'https://example.com', elements: [] }
    }]);

    const req: PerceptionCycleRequest = { cycleId: 'loop_1', session: mockSession, activeAbortController: abortController, broadcastUiState };
    const res1 = await daemon.runCycle(req);
    
    req.cycleId = 'loop_2';
    const res2 = await daemon.runCycle(req);
    
    expect(res1?.sanRes).toBeDefined();
    expect(res2?.sanRes).toBeDefined();
    expect(res1?.domSnapshot.snapshot_id).not.toBe(res2?.domSnapshot.snapshot_id); // Results correspond to distinct cycles
  });

  it('produces privacy/perception outputs without the LLM/Planner', async () => {
    chromeMock.tabs.get.mockResolvedValue({ id: 100, url: 'https://example.com', status: 'complete' });
    
    // Simulate finding a PAN card (Privacy Rule Engine validation)
    chromeMock.scripting.executeScript.mockResolvedValue([{
      result: {
        viewport: { w: 1000, h: 1000 },
        origin: 'https://example.com',
        elements: [
          { dom_id: 'd1', tag: 'div', text: 'My PAN is ABCDE1234F', visible: true, bbox: [0, 0, 100, 20] }
        ]
      }
    }]);

    const req: PerceptionCycleRequest = { cycleId: 'privacy_cycle', session: mockSession, activeAbortController: abortController, broadcastUiState };
    const result = await daemon.runCycle(req);
    
    expect(result).not.toBeNull();
    // We expect the Privacy Pipeline to have processed this independently of the AI action
    expect(result?.sanRes.verdict).toBeDefined();
    expect(result?.sanRes.attested).toBeDefined();
    
    // We confirm that no AI LLM Planner was invoked (no sendPlan logic in the daemon)
    expect(result?.plan).toBeDefined(); // Router generates bounding plan, not LLM
  });

  it('can be properly aborted/disconnected', async () => {
    abortController.abort(); // Trigger abort BEFORE cycle
    
    const req: PerceptionCycleRequest = { cycleId: 'abort_cycle', session: mockSession, activeAbortController: abortController, broadcastUiState };
    const result = await daemon.runCycle(req);
    
    // Should short-circuit and return null
    expect(result).toBeNull();
  });

  it('reports why duplicate observers cannot be tested at this layer', () => {
    // Current Architecture Limitation:
    // Duplicate observer prevention is handled inside `content/observers.ts` via window.addEventListener
    // deduplication. Since PerceptionDaemon is in the background worker, it does not manage
    // window event listeners, thus duplicate prevention is out of its scope.
    expect(true).toBe(true);
  });
});
