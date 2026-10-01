import { StandaloneAgent } from '../protocol/agent-contract.js';
import { AgentObservation } from '../protocol/observation.js';
import { AgentAction, AgentActionResult } from '../protocol/action.js';
import { TaskState } from './task.js';
import { LLMProvider } from '../providers/provider-interface.js';
import { ActionValidator } from '../actions/validator.js';

export class BaseStandaloneAgent implements StandaloneAgent {
  private tasks: Map<string, TaskState> = new Map();
  private maxRetries = 3;
  private consecutiveFailures: Map<string, number> = new Map();

  constructor(private provider: LLMProvider) {}

  startTask(taskId: string, instruction: string, maxSteps: number = 15): TaskState {
    const state: TaskState = {
      id: taskId,
      instruction,
      status: 'CREATED',
      max_steps: maxSteps,
      current_step: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.tasks.set(taskId, state);
    this.consecutiveFailures.set(taskId, 0);
    return state;
  }

  async step(taskId: string, observation: AgentObservation): Promise<AgentAction | null> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.status === 'CANCELLED' || task.status === 'COMPLETED' || task.status === 'FAILED') {
      return null;
    }

    if (task.current_step >= task.max_steps) {
      task.status = 'FAILED';
      task.last_error = 'Max steps exceeded';
      task.updated_at = Date.now();
      return null;
    }

    task.status = 'PLANNING';
    task.updated_at = Date.now();

    try {
      const response = await this.provider.plan(task.instruction, observation);
      const action = response.action;

      const validation = ActionValidator.validate(action, observation);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }

      task.status = 'ACTION_READY';
      task.current_step++;
      task.updated_at = Date.now();
      
      // Reset failures on successful plan & validate
      this.consecutiveFailures.set(taskId, 0);

      // In real lifecycle, it would become WAITING_FOR_RESULT as soon as returned
      return action;
    } catch (err: any) {
      const failures = (this.consecutiveFailures.get(taskId) || 0) + 1;
      this.consecutiveFailures.set(taskId, failures);

      if (failures >= this.maxRetries) {
        task.status = 'FAILED';
        task.last_error = `Provider failed consistently: ${err.message}`;
      } else {
        // Fallback to observing state so we can retry on next tick
        task.status = 'OBSERVING';
        task.last_error = `Step failed: ${err.message}`;
      }
      task.updated_at = Date.now();
      return null;
    }
  }

  reportResult(taskId: string, result: AgentActionResult): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.status === 'CANCELLED') return;

    if (result.ok) {
      task.status = 'OBSERVING';
      task.last_error = undefined;
    } else {
      task.status = 'FAILED';
      task.last_error = result.message || 'Action failed in execution';
    }
    task.updated_at = Date.now();
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'CANCELLED';
      task.updated_at = Date.now();
    }
  }

  getTaskState(taskId: string): TaskState | null {
    return this.tasks.get(taskId) || null;
  }
}
