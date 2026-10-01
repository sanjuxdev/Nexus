import { AgentAction } from '../protocol/action.js';
import { AgentObservation } from '../protocol/observation.js';

export class ActionValidator {
  /**
   * Deterministically validates whether the generated action is well-formed
   * and supported by the current observation context.
   */
  static validate(action: AgentAction, observation: AgentObservation): { valid: boolean; reason?: string } {
    if (!action || !action.type) {
      return { valid: false, reason: 'Action is missing a valid type.' };
    }

    // Validate specific required parameters based on action type
    switch (action.type) {
      case 'click':
      case 'type':
      case 'select':
        if (!action.target_region_id) {
          return { valid: false, reason: `Action '${action.type}' requires a target_region_id.` };
        }
        // Verify the region exists in the current observation
        const regionExists = observation.regions.some(r => r.region_id === action.target_region_id);
        if (!regionExists) {
          return { valid: false, reason: `Target region_id '${action.target_region_id}' not found in observation.` };
        }
        
        if (action.type === 'type' && !action.params?.text) {
          return { valid: false, reason: `Action 'type' requires params.text.` };
        }
        break;

      case 'scroll':
        if (!action.params?.direction) {
          return { valid: false, reason: `Action 'scroll' requires params.direction.` };
        }
        if (!['up', 'down', 'left', 'right'].includes(action.params.direction)) {
          return { valid: false, reason: `Invalid scroll direction: ${action.params.direction}.` };
        }
        break;
        
      case 'navigate':
        if (!action.params?.url) {
          return { valid: false, reason: `Action 'navigate' requires params.url.` };
        }
        break;

      case 'wait':
      case 'read':
      case 'find':
      case 'back':
      case 'forward':
      case 'complete':
      case 'fail':
        // These can be generic
        break;

      default:
        return { valid: false, reason: `Unsupported action type: ${(action as any).type}` };
    }

    return { valid: true };
  }
}
