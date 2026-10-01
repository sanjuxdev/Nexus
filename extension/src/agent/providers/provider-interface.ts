import { AgentObservation } from '../protocol/observation.js';
import { AgentAction } from '../protocol/action.js';

export interface ProviderPlanResponse {
  action: AgentAction;
  usage?: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    server_ms: number;
  };
}

export interface LLMProvider {
  /**
   * Plans the next action based on the task instruction and the latest observation.
   */
  plan(instruction: string, observation: AgentObservation, signal?: AbortSignal): Promise<ProviderPlanResponse>;
}
