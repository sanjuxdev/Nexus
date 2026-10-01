import React, { useEffect, useState } from 'react';
import type { UiState } from '@contracts/index.js';
import { bus } from '@contracts/index.js';
import { TaskBar } from './TaskBar.js';
import { VisualPreview } from './VisualPreview.js';
import { NetworkStatus } from './NetworkStatus.js';

export const App: React.FC = () => {
  const [uiState, setUiState] = useState<UiState>({
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
  });

  useEffect(() => {
    // 1. Fetch initial state
    bus.send('ui/get-state', {}).then((res) => {
      if (res.ok) {
        setUiState(res.data);
      }
    });

    // 2. Subscribe to live updates from Service Worker
    const unbind = bus.on('ui/state', (state) => {
      setUiState(state);
      return { received: true };
    });

    // 3. Polling fallback to guarantee synchronization during active tasks
    const pollInterval = setInterval(() => {
      bus.send('ui/get-state', {}).then((res) => {
        if (res.ok) {
          setUiState(res.data);
        }
      });
    }, 600);

    return () => {
      unbind();
      clearInterval(pollInterval);
    };
  }, []);

  const handleStart = async () => {
    let tabId: number | undefined = undefined;

    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        const webTabs = allTabs.filter(
          (t) =>
            t.id &&
            t.url &&
            !t.url.startsWith('chrome-extension://') &&
            !t.url.startsWith('chrome://') &&
            !t.url.startsWith('chrome-error://') &&
            t.url !== 'about:blank'
        );
        let activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const candidateActive = activeTabs?.find((t) => t.id && t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
        tabId = candidateActive?.id || webTabs.find((t) => t.active)?.id || webTabs[0]?.id;
      } catch (err) {
        console.warn('[SidePanel] Could not query active tab:', err);
      }
    }

    setUiState((prev) => ({
      ...prev,
      task_text: 'Privacy Protection Active',
      state: 'PERCEIVING',
      last_error: null,
    }));

    try {
      const res = await bus.send('privacy/start', { tab_id: tabId });
      if (res.ok) {
        setUiState((prev) => ({
          ...prev,
          task_id: res.data.task_id,
        }));
      } else {
        setUiState((prev) => ({
          ...prev,
          state: 'FAILED',
          last_error: res.error,
        }));
      }
    } catch (err: any) {
      setUiState((prev) => ({
        ...prev,
        state: 'FAILED',
        last_error: {
          code: 'INTERNAL',
          stage: 'dom',
          message: err.message || String(err),
          retryable: false,
        },
      }));
    }
  };

  const handleCancel = async () => {
    try {
      await bus.send('privacy/stop', { task_id: uiState.task_id || '' });
    } catch (err) {
      console.warn('[SidePanel] Failed to send stop:', err);
    }
    setUiState((prev) => ({
      ...prev,
      state: 'IDLE',
      task_id: null,
      last_error: null,
      requires_user_confirmation: false,
      pending_action_description: null,
    }));
  };

  const handleConfirm = (confirmed: boolean) => {
    if (uiState.task_id) {
      bus.send('task/confirm', { task_id: uiState.task_id, confirmed });
    }
    setUiState((prev) => ({ ...prev, requires_user_confirmation: false }));
  };

  const handleRecordFixture = async () => {
    const snap = await bus.send('dom/snapshot', {});
    if (snap.ok) {
      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snap.data, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `dom.fixture.${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--card-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--card-bg)',
        }}
      >
        <div>
          <h1 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
            Nexus
          </h1>
          <p style={{ fontSize: '11px', color: 'var(--muted)' }}>
            On-device Perception & Action Security
          </p>
        </div>
        <button
          onClick={handleRecordFixture}
          title="Record current DOM & state as a golden test fixture (Task 1.6)"
          style={{
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid var(--card-border)',
            background: 'var(--bg)',
            color: 'var(--muted)',
            cursor: 'pointer',
          }}
        >
          Capture Fixture
        </button>
      </header>

      {/* Task Controller */}
      <TaskBar
        state={uiState.state}
        onStart={handleStart}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        requiresConfirmation={uiState.requires_user_confirmation}
        confirmationText={uiState.pending_action_description}
      />

      {/* Visual Masked Preview */}
      <VisualPreview audit={uiState.privacy_audit} />

      {/* Network Security Gate & Redaction Proof */}
      <NetworkStatus
        status={uiState.attestation_status}
        piiSummary={uiState.pii_summary}
        privacyAudit={uiState.privacy_audit}
      />

      {/* Error alert banner if any */}
      {uiState.last_error && (
        <div
          style={{
            margin: '12px',
            padding: '10px',
            borderRadius: 'var(--radius)',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            fontSize: '12px',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>
            [{uiState.last_error.code}] {uiState.last_error.stage.toUpperCase()}
          </div>
          <div>{uiState.last_error.message}</div>
        </div>
      )}
    </div>
  );
};
