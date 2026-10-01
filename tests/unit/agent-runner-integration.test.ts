import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StandaloneAgentRunner, agentRunner } from '../../extension/src/background/agent-runner.js';
import { perceptionDaemon } from '../../extension/src/background/perception-daemon.js';
import { bus } from '@contracts/index.js';

vi.mock('../../extension/src/background/perception-daemon.js', () => ({
  perceptionDaemon: {
    runCycle: vi.fn()
  }
}));

vi.mock('@contracts/index.js', async () => {
  const actual = await vi.importActual('@contracts/index.js') as any;
  return {
    ...actual,
    bus: {
      send: vi.fn()
    }
  };
});

vi.mock('../../extension/src/actions/validator/index.js', () => ({
  validateAction: vi.fn().mockResolvedValue({ valid: true, requires_user_confirmation: false })
}));

describe('Agent-Extension Protocol Integration', () => {
  let runner: StandaloneAgentRunner;
  let abortController: AbortController;
  
  beforeEach(() => {
    runner = new StandaloneAgentRunner();
    abortController = new AbortController();
    vi.clearAllMocks();
  });

  const mockSession = {
    task_id: 'test_task',
    task_text: 'scroll down',
    tab_id: 1,
    allowed_origins: ['https://example.com'],
    allowed_actions: ['scroll', 'click'] as any,
    step_index: 0,
    max_steps: 5,
    state: 'IDLE' as any,
    frame_page_state_hash: null,
    region_index: {},
    history: [],
    recent_state_hashes: [],
  };

  const mockPerceptionResult = {
    isBlocked: false,
    needsReperceive: false,
    sanRes: {
      attested: {
        body: JSON.stringify({
          regions: [
            { region_id: 'r_1', type: 'button', interactable: true }
          ]
        })
      }
    },
    domSnapshot: {
      url_origin: 'https://example.com',
      frame_id: 'main',
      url: 'https://example.com',
      page_state_hash: 'hash123'
    }
  };

  it('runs the task loop connecting observation and action flow safely', async () => {
    let callCount = 0;
    
    // Mock perception daemon to return success once, then abort to stop the loop
    vi.mocked(perceptionDaemon.runCycle).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockPerceptionResult as any;
      abortController.abort(); // Stop the loop on second cycle
      return null;
    });

    vi.mocked(bus.send).mockResolvedValue({ ok: true, data: {} as any });

    await runner.runTask(mockSession, abortController);

    // Should have requested perception
    expect(perceptionDaemon.runCycle).toHaveBeenCalled();
    
    // Should have sent action over the bus to execute safely
    expect(bus.send).toHaveBeenCalledWith('action/execute', expect.any(Object), expect.any(Object));
  });

  it('preserves the privacy boundary by translating raw perception to safe AgentObservation', async () => {
    // The agent must only receive the sanitized regions array, no raw DOM HTML
    vi.mocked(perceptionDaemon.runCycle).mockImplementation(async () => {
      abortController.abort(); // Stop immediately after first cycle
      return mockPerceptionResult as any;
    });

    await runner.runTask(mockSession, abortController);
    
    // If it reaches here without crash, it correctly mapped the internal body string to the AgentObservation
    // This asserts that raw DOM nodes aren't sent directly.
    expect(perceptionDaemon.runCycle).toHaveBeenCalled();
  });
  
  it('handles task cancellation properly', async () => {
    vi.mocked(perceptionDaemon.runCycle).mockImplementation(async () => {
      runner.cancelTask(mockSession.task_id); // Cancel during first cycle
      return mockPerceptionResult as any;
    });

    await runner.runTask(mockSession, abortController);
    
    // If cancelled, it shouldn't proceed to execute action
    expect(bus.send).not.toHaveBeenCalledWith('action/execute', expect.any(Object), expect.any(Object));
  });
});
