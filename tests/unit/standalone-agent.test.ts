import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseStandaloneAgent } from '../../extension/src/agent/core/agent.js';
import { LLMProvider, ProviderPlanResponse } from '../../extension/src/agent/providers/provider-interface.js';
import { AgentObservation } from '../../extension/src/agent/protocol/observation.js';
import { AgentAction } from '../../extension/src/agent/protocol/action.js';
import { ActionValidator } from '../../extension/src/agent/actions/validator.js';

class MockProvider implements LLMProvider {
  async plan(instruction: string, observation: AgentObservation): Promise<ProviderPlanResponse> {
    return {
      action: {
        id: 'act_123',
        type: 'click',
        target_region_id: 'r_1'
      }
    };
  }
}

describe('Standalone AI Agent Core', () => {
  let agent: BaseStandaloneAgent;
  let mockProvider: MockProvider;

  beforeEach(() => {
    mockProvider = new MockProvider();
    agent = new BaseStandaloneAgent(mockProvider);
  });

  const validObservation: AgentObservation = {
    task_id: 't_1',
    cycle_id: 'c_1',
    page_state_hash: 'hash',
    origin: 'https://example.com',
    frame_id: 'main',
    url: 'https://example.com',
    timestamp: Date.now(),
    regions: [
      { region_id: 'r_1', type: 'button', text: 'Submit', interactable: true }
    ],
    history: []
  };

  it('manages task lifecycle and validates action successfully', async () => {
    const task = agent.startTask('t_1', 'click the submit button', 5);
    expect(task.status).toBe('CREATED');
    expect(task.current_step).toBe(0);

    const action = await agent.step('t_1', validObservation);
    expect(action).not.toBeNull();
    expect(action?.type).toBe('click');
    expect(agent.getTaskState('t_1')?.status).toBe('ACTION_READY');
    expect(agent.getTaskState('t_1')?.current_step).toBe(1);

    agent.reportResult('t_1', { action_id: action!.id, ok: true });
    expect(agent.getTaskState('t_1')?.status).toBe('OBSERVING');
  });

  it('cancels the task properly', async () => {
    agent.startTask('t_2', 'do something');
    agent.cancelTask('t_2');
    expect(agent.getTaskState('t_2')?.status).toBe('CANCELLED');

    const action = await agent.step('t_2', validObservation);
    expect(action).toBeNull();
  });

  it('handles provider failures and retries', async () => {
    vi.spyOn(mockProvider, 'plan').mockRejectedValue(new Error('Provider timeout'));
    agent.startTask('t_3', 'do something');

    await agent.step('t_3', validObservation);
    expect(agent.getTaskState('t_3')?.status).toBe('OBSERVING');
    
    await agent.step('t_3', validObservation);
    await agent.step('t_3', validObservation);
    
    // 3rd failure means MAX retries reached
    expect(agent.getTaskState('t_3')?.status).toBe('FAILED');
  });

  it('validates actions securely (privacy & malformed prevention)', () => {
    const invalidAction: AgentAction = { id: 'act', type: 'click', target_region_id: 'fake_region' };
    const result = ActionValidator.validate(invalidAction, validObservation);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not found in observation');
  });

  it('completes the task upon reaching max steps', async () => {
    agent.startTask('t_4', 'do something', 1);
    await agent.step('t_4', validObservation); // step 1
    const state = agent.getTaskState('t_4');
    expect(state?.current_step).toBe(1);
    
    // next step should fail due to max steps
    await agent.step('t_4', validObservation);
    expect(agent.getTaskState('t_4')?.status).toBe('FAILED');
  });
});
