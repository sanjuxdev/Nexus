import type {
  AttestedPayload,
  BusResponse,
  DomSnapshot,
  PlanResponse,
  SanitizeRequest,
  SanitizeResult,
  StageError,
  StructuredAction,
  TaskSession,
  UiState,
  ValidationVerdict,

  TargetResolution,
} from '@contracts/index.js';
import { bus, stageError } from '@contracts/index.js';
import { startSpan } from '../telemetry/span.js';
import { sessionStore } from './session.js';
import { startKeepalive, stopKeepalive } from './keepalive.js';
import { ensureOffscreen } from './offscreen.js';
import { agentRunner } from './agent-runner.js';

let currentUiState: UiState = {
  task_id: null,
  task_text: '',
  state: 'IDLE',
  cycle_id: null,
  step_index: 0,
  max_steps: 15,
  last_error: null,
  last_verdict: null,
  last_action: null,
  last_exec_result: null,
  routes: [],
  pii_summary: [],
  attestation_status: 'none',
  requires_user_confirmation: false,
  pending_action_description: null,
};

export function getUiState(): UiState {
  return { ...currentUiState };
}

function broadcastUiState(partial: Partial<UiState>): void {
  currentUiState = { ...currentUiState, ...partial };
  bus.send('ui/state', currentUiState).catch(() => {});
}

let activeAbortController: AbortController | null = null;
let activeSession: TaskSession | null = null;

export const taskController = {
  async startTask(taskText: string, tabId = 0): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    activeAbortController?.abort();
    activeAbortController = new AbortController();

    const initialOrigins = ['http://localhost:5173', 'http://localhost:5174'];
    if (tabId > 0 && typeof chrome !== 'undefined' && chrome.tabs?.get) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          const origin = new URL(tab.url).origin;
          if (!initialOrigins.includes(origin)) {
            initialOrigins.push(origin);
          }
        }
      } catch {}
    }

    const session: TaskSession = {
      task_id: taskId,
      task_text: taskText,
      tab_id: tabId,
      allowed_origins: initialOrigins,
      allowed_actions: ['click', 'type', 'fill_secret', 'select', 'scroll', 'focus', 'keypress', 'navigate', 'back'],
      step_index: 0,
      max_steps: 15,
      state: 'IDLE',
      frame_page_state_hash: null,
      region_index: {},
      history: [],
      recent_state_hashes: [],
    };

    activeSession = session;
    await sessionStore.save(session).catch(() => {});
    startKeepalive();
    await ensureOffscreen().catch((err) => console.warn('[Offscreen] Init warning:', err));

    console.log('[Orchestrator] startTask initialized, launching runLoop for taskId:', taskId);
    broadcastUiState({
      task_id: taskId,
      task_text: taskText,
      state: 'IDLE',
      step_index: 0,
      max_steps: 15,
      last_error: null,
      last_verdict: null,
      last_action: null,
      last_exec_result: null,
    });

    // Run autonomous loop in background via StandaloneAgentRunner
    console.log('[TaskController] Dispatching to AgentRunner...');
    agentRunner.runTask(session, activeAbortController!).catch((err: any) => {
      console.error('[AgentRunner] fatal error:', err);
      session.state = 'FAILED';
      sessionStore.save(session);
      broadcastUiState({ state: 'FAILED', last_error: stageError('INTERNAL', 'dom', err.message || String(err)) });
      stopKeepalive();
    });

    return taskId;
  },

  async cancelTask(taskId?: string): Promise<void> {
    console.log('[Orchestrator] Cancelling task:', taskId, 'activeSession:', activeSession?.task_id);
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    if (activeSession) {
      activeSession.state = 'FAILED';
      await sessionStore.save(activeSession).catch(() => {});
      activeSession = null;
    }
    stopKeepalive();
    broadcastUiState({
      task_id: null,
      state: 'IDLE',
      last_error: null,
      requires_user_confirmation: false,
      pending_action_description: null,
    });
  },

  async confirmTaskAction(taskId: string, confirmed: boolean): Promise<void> {
    if (currentUiState.task_id === taskId && currentUiState.requires_user_confirmation) {
      broadcastUiState({ requires_user_confirmation: false });
      // If confirmed, proceed with execution
    }
  },
};
