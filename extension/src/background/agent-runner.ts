import { BaseStandaloneAgent } from '../agent/core/agent.js';
import { LLMProvider, ProviderPlanResponse } from '../agent/providers/provider-interface.js';
import { AgentObservation } from '../agent/protocol/observation.js';
import { AgentAction, AgentActionResult } from '../agent/protocol/action.js';
import { perceptionDaemon } from './perception-daemon.js';
import { bus } from '@contracts/index.js';
import { validateAction } from '../actions/validator/index.js';
import { dispatchNativeClick, dispatchNativeType } from './debugger.js';
import type { TaskSession, StructuredAction } from '@contracts/index.js';

/**
 * A mock LLM provider just for the sake of the standalone agent's loop testing
 * in the extension context. Normally this would call the actual backend.
 */
class ExtensionLocalProvider implements LLMProvider {
  async plan(instruction: string, observation: AgentObservation): Promise<ProviderPlanResponse> {
    const inst = instruction.toLowerCase();
    
    // Check if task is already complete
    const hasSuccess = observation.history.some(h => h.status === 'success');
    if (inst.includes('wait') && hasSuccess) {
        return { action: { id: `act_${Date.now()}`, type: 'done' } as any }; // Will let runner transition state
    }

    // 1. Scroll Intent
    if (inst.includes('scroll')) {
      const direction = inst.includes('up') ? 'up' : 'down';
      return {
        action: {
          id: `act_${Date.now()}`,
          type: 'scroll',
          target_region_id: undefined,
          params: { direction, amount: 500 }
        }
      };
    }
    
    // 2. Navigate Intent
    if (inst.includes('navigate to') || inst.includes('go to')) {
       // Mock for now or implement if params.url was supported
       // Actually `navigate` doesn't take url in AgentAction currently, it relies on runner/contracts.
       // Let's assume click or search instead
    }
    if (inst.includes('go back')) {
      return { action: { id: `act_${Date.now()}`, type: 'back', target_region_id: undefined, params: undefined } };
    }

    // 3. Type / Search Intent
    const typeMatch = inst.match(/type\s+['"]?([^'"]+)['"]?\s+into\s+(.+)/) || inst.match(/search for\s+['"]?([^'"]+)['"]?/);
    if (typeMatch) {
      const textToType = typeMatch[1];
      const targetHint = typeMatch[2] || 'search';
      
      const target = observation.regions.find(r => 
        r.interactable && 
        (r.type === 'input' || r.type === 'textarea' || (r.text && r.text.toLowerCase().includes(targetHint)))
      );
      
      if (target) {
        // If we found a target, return type action
        return {
          action: {
            id: `act_${Date.now()}`,
            type: 'type',
            target_region_id: target.region_id,
            params: { text: textToType }
          }
        };
      }
    }

    // 4. Click Intent
    const clickMatch = inst.match(/click\s+(?:the\s+)?(.+)/) || inst.match(/open\s+(?:the\s+)?(.+)/);
    if (clickMatch) {
      const targetHint = clickMatch[1] ? clickMatch[1].replace(/(button|link)/g, '').trim() : '';
      
      const target = observation.regions.find(r => 
        r.interactable && r.text && r.text.toLowerCase().includes(targetHint)
      ) || observation.regions.find(r => r.interactable);
      
      if (target) {
        return {
          action: {
            id: `act_${Date.now()}`,
            type: 'click',
            target_region_id: target.region_id,
            params: undefined
          }
        };
      }
    }
    
    // Fallback: If there's an interactable element, just click it (for basic tests)
    const fallbackTarget = observation.regions.find(r => r.interactable && r.type === 'button') || observation.regions[0];
    if (fallbackTarget) {
      return {
        action: {
          id: `act_${Date.now()}`,
          type: 'click',
          target_region_id: fallbackTarget.region_id,
          params: undefined
        }
      };
    }

    // No target found
    return { action: { id: `act_${Date.now()}`, type: 'done' } as any };
  }
}

export class StandaloneAgentRunner {
  private agent: BaseStandaloneAgent;
  private activeTasks: Set<string> = new Set();
  
  constructor() {
    this.agent = new BaseStandaloneAgent(new ExtensionLocalProvider());
  }

  /**
   * Translates the PerceptionDaemon's complex output into the strictly sanitized AgentObservation
   */
  private buildObservation(cycleId: string, session: TaskSession, sanRes: any, domSnapshot: any): AgentObservation {
    const parsedContext = JSON.parse(sanRes.attested!.body);
    
    return {
      task_id: session.task_id,
      cycle_id: cycleId,
      page_state_hash: domSnapshot.page_state_hash,
      origin: domSnapshot.url_origin,
      frame_id: domSnapshot.frame_id || 'main',
      url: domSnapshot.url,
      timestamp: Date.now(),
      regions: parsedContext.regions.map((r: any) => ({
        region_id: r.region_id,
        type: r.type,
        text: r.text,
        interactable: r.interactable
      })),
      history: session.history.map(h => ({
        action_type: h.action,
        status: h.result === 'ok' ? 'success' : 'failed',
        message: h.note || undefined
      }))
    };
  }

  /**
   * Translates the AgentAction back into the legacy StructuredAction for the extension's execution gateway
   */
  private translateAction(agentAction: AgentAction, origin: string, frameId: string, hash: string): StructuredAction {
    return {
      action_id: agentAction.id,
      request_id: `req_${Date.now()}`,
      action: agentAction.type as any,
      target: agentAction.target_region_id ? { region_id: agentAction.target_region_id } : null,
      params: agentAction.params as any,
      capability: null,
      origin: origin as any,
      frame_id: frameId as any,
      page_state_hash: hash,
      rationale: agentAction.rationale
    };
  }

  /**
   * Start and manage the lifecycle of a task explicitly through the standalone agent.
   */
  public async runTask(session: TaskSession, abortController: AbortController): Promise<void> {
    const taskId = session.task_id;
    this.activeTasks.add(taskId);
    
    this.agent.startTask(taskId, session.task_text, session.max_steps);
    console.log(`[AgentRunner] Started task ${taskId}`);

    let stepIndex = 0;
    while (this.activeTasks.has(taskId) && !abortController.signal.aborted) {
      const taskState = this.agent.getTaskState(taskId);
      if (!taskState || taskState.status === 'COMPLETED' || taskState.status === 'FAILED' || taskState.status === 'CANCELLED') {
        break;
      }

      const cycleId = `cyc_${stepIndex}_${Date.now()}`;
      
      // 1. Get perception explicitly
      const cycleReq = { cycleId, session, activeAbortController: abortController, broadcastUiState: () => {} };
      const perceptionResult = await perceptionDaemon.runCycle(cycleReq);
      
      if (!perceptionResult || perceptionResult.isBlocked || perceptionResult.needsReperceive) {
        if (perceptionResult?.needsReperceive) {
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        break;
      }

      // 2. Build explicit privacy boundary observation
      const observation = this.buildObservation(cycleId, session, perceptionResult.sanRes, perceptionResult.domSnapshot);

      // 3. Agent planning step
      const agentAction = await this.agent.step(taskId, observation);
      if (!agentAction) {
        // Could be provider failure or max steps reached
        continue; 
      }

      // 4. Translate action to extension schema and validate
      const structuredAction = this.translateAction(
        agentAction, 
        observation.origin, 
        observation.frame_id, 
        observation.page_state_hash
      );

      const verdict = await validateAction(structuredAction, {
        session,
        liveOrigin: observation.origin,
        liveFrameId: observation.frame_id,
        recentStateHashes: [],
      });

      if (!verdict.valid) {
        // Validation failed, report failure to agent so it retries
        this.agent.reportResult(taskId, { action_id: agentAction.id, ok: false, message: verdict.reason || 'Validation failed' });
        continue;
      }

      // 5. Execute safely via browser action gateway
      let executed = false;
      try {
        if (typeof chrome !== 'undefined' && chrome.debugger && structuredAction.action === 'scroll') {
           // Basic fallback scroll simulation to test refresh bug logic
           await bus.send('action/execute', { action: structuredAction }, { tabId: session.tab_id });
           executed = true;
        } else {
           await bus.send('action/execute', { action: structuredAction }, { tabId: session.tab_id });
           executed = true;
        }
      } catch (e: any) {
        this.agent.reportResult(taskId, { action_id: agentAction.id, ok: false, message: e.message });
        continue;
      }

      // 6. Report success back to Agent
      this.agent.reportResult(taskId, { action_id: agentAction.id, ok: true, navigated: false });
      
      stepIndex++;
      await new Promise(r => setTimeout(r, 1000)); // small delay between steps
    }

    this.activeTasks.delete(taskId);
    console.log(`[AgentRunner] Task ${taskId} terminated with state:`, this.agent.getTaskState(taskId)?.status);
  }

  public cancelTask(taskId: string) {
    this.agent.cancelTask(taskId);
    this.activeTasks.delete(taskId);
  }
}

export const agentRunner = new StandaloneAgentRunner();
