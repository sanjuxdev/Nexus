import { AgentObservation } from './observation.js';
import { AgentAction, AgentActionResult } from './action.js';
import { TaskState } from '../core/task.js';

export interface StandaloneAgent {
  /**
   * Initializes a new task with the given instruction and maximum steps.
   */
  startTask(taskId: string, instruction: string, maxSteps?: number): TaskState;

  /**
   * Provides the agent with a new observation and requests the next action.
   * This handles the PLANNING -> ACTION_READY transition.
   */
  step(taskId: string, observation: AgentObservation): Promise<AgentAction | null>;

  /**
   * Reports the result of the previously executed action back to the agent.
   * This handles the WAITING_FOR_RESULT -> OBSERVING transition.
   */
  reportResult(taskId: string, result: AgentActionResult): void;

  /**
   * Cancels an ongoing task.
   */
  cancelTask(taskId: string): void;

  /**
   * Gets the current state of a task.
   */
  getTaskState(taskId: string): TaskState | null;
}
