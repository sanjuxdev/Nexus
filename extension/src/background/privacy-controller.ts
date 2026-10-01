import { bus, stageError } from '@contracts/index.js';
import type { UiState, TaskSession } from '@contracts/index.js';
import { PerceptionDaemon } from './perception-daemon.js';
import { ensureOffscreen } from './offscreen.js';

let currentUiState: UiState = {
  task_id: null,
  task_text: 'Privacy Protection Active',
  state: 'IDLE',
  cycle_id: null,
  step_index: 0,
  max_steps: 0,
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
let isProtecting = false;

// Scroll/mutation wake-up mechanism: allows the idle sleep to be interrupted
// so the next perception cycle starts immediately after a scroll.
let _wakeResolve: (() => void) | null = null;

function interruptibleSleep(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      _wakeResolve = null;
      resolve();
    }, ms);

    // Allow external wake-up to cut the sleep short
    _wakeResolve = () => {
      clearTimeout(timer);
      _wakeResolve = null;
      resolve();
    };

    // Also resolve immediately if the task is aborted
    if (abortSignal.aborted) {
      clearTimeout(timer);
      _wakeResolve = null;
      resolve();
    }
  });
}

/** Called by dom/dirty handler to wake the loop immediately */
export function wakePrivacyLoop(): void {
  if (_wakeResolve) {
    _wakeResolve();
  }
}

async function runPrivacyLoop(session: TaskSession, abortController: AbortController) {
  const daemon = new PerceptionDaemon();
  isProtecting = true;

  // Default interval between cycles (ms). Kept short so masks refresh quickly.
  const NORMAL_INTERVAL_MS = 800;
  const ERROR_INTERVAL_MS  = 3000;
  
  while (!abortController.signal.aborted && isProtecting) {
    const cycleId = `cycle_${Date.now()}`;
    try {
      const res = await daemon.runCycle({
        cycleId,
        session,
        activeAbortController: abortController,
        broadcastUiState,
      });
      
      if (!res || res.needsReperceive) {
        await interruptibleSleep(600, abortController.signal);
        continue;
      }

      if (res.isBlocked) {
        // Handled by UI broadcast within perception-daemon, just wait
        await interruptibleSleep(1000, abortController.signal);
        continue;
      }
      
      broadcastUiState({
        state: 'PERCEIVING',
        privacy_audit: {
          attestation_digest: res.sanRes.attested?.sha256 || null,
          egress_body_preview: null,
          masked_image_url: res.sanRes.masked_data_url || null,
          items: res.sanRes.detections.map((d: any) => ({
            id: d.id,
            type: d.type,
            label: d.type,
            redacted_as: `<${d.type}>`,
            method: d.source.join(','),
            bbox: d.bbox
          })),
          stats: {
            total_redactions: res.sanRes.redaction.text_replacements + res.sanRes.redaction.masked_boxes,
            text_replacements: res.sanRes.redaction.text_replacements,
            masked_boxes: res.sanRes.redaction.masked_boxes,
            masked_area_px: res.sanRes.redaction.masked_area_px
          }
        },
      });
      
      // Interruptible sleep: wakePrivacyLoop() cuts this short on scroll/mutation
      await interruptibleSleep(NORMAL_INTERVAL_MS, abortController.signal);
    } catch (err: any) {
      console.error('[PrivacyController] Loop error:', err);
      broadcastUiState({
        state: 'PERCEIVING',
        last_error: stageError('INTERNAL', 'dom', err.message || String(err)),
      });
      await interruptibleSleep(ERROR_INTERVAL_MS, abortController.signal);
    }
  }
}

export const privacyController = {
  async startProtection(tabId = 0): Promise<string> {
    const taskId = `privacy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();

    try {
      await ensureOffscreen();
    } catch (err) {
      console.warn('[PrivacyController] Failed to initialize offscreen document:', err);
    }

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
      task_text: 'Privacy Protection Active',
      tab_id: tabId,
      allowed_origins: initialOrigins,
      allowed_actions: [], // Explicitly empty for privacy-only mode
      step_index: 0,
      max_steps: 0,
      state: 'PERCEIVING',
      frame_page_state_hash: null,
      region_index: {},
      history: [],
      recent_state_hashes: [],
    };

    activeSession = session;
    
    console.log('[PrivacyController] startProtection initialized, launching privacy loop');
    broadcastUiState({
      task_id: taskId,
      state: 'PERCEIVING',
      last_error: null,
    });

    runPrivacyLoop(session, activeAbortController).catch((err: any) => {
      console.error('[PrivacyController] fatal error in loop:', err);
      broadcastUiState({ state: 'FAILED', last_error: stageError('INTERNAL', 'dom', err.message || String(err)) });
    });

    return taskId;
  },

  async stopProtection(taskId?: string): Promise<void> {
    console.log('[PrivacyController] Stopping protection');
    isProtecting = false;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    if (activeSession) {
      activeSession = null;
    }
    broadcastUiState({
      task_id: null,
      state: 'IDLE',
      last_error: null,
      requires_user_confirmation: false,
      pending_action_description: null,
    });
  },
};
