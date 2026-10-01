import React from 'react';
import type { OrchestratorState } from '@contracts/index.js';

interface TaskBarProps {
  state: OrchestratorState;
  onStart: () => void;
  onCancel: () => void;
  onConfirm: (confirmed: boolean) => void;
  requiresConfirmation: boolean;
  confirmationText: string | null;
}

export const TaskBar: React.FC<TaskBarProps> = ({
  state,
  onStart,
  onCancel,
  onConfirm,
  requiresConfirmation,
  confirmationText,
}) => {
  const isRunning =
    state !== 'IDLE' &&
    state !== 'DONE' &&
    state !== 'FAILED' &&
    state !== 'BLOCKED_BY_PRIVACY' &&
    state !== 'SERVER_UNAVAILABLE';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRunning) {
      onStart();
    }
  };

  return (
    <div style={{ padding: '12px', borderBottom: '1px solid var(--card-border)' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--card-border)',
              background: 'var(--card-bg)',
              color: 'var(--fg)',
              fontSize: '13px',
            }}
          >
            {isRunning ? 'Status: ● PROTECTING' : 'Status: ○ IDLE'}
          </div>
          {!isRunning ? (
            <button
              type="submit"
              onClick={(e) => {
                e.preventDefault();
                onStart();
              }}
              aria-label="Start Protection"
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius)',
                border: 'none',
                background: 'var(--accent)',
                color: '#ffffff',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Start
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop Protection"
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius)',
                border: 'none',
                background: 'var(--danger)',
                color: '#ffffff',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Stop
            </button>
          )}
        </div>

        {requiresConfirmation && (
          <div
            style={{
              padding: '10px',
              borderRadius: 'var(--radius)',
              background: 'rgba(217, 119, 6, 0.1)',
              border: '1px solid var(--warning)',
              marginTop: '4px',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--warning)', marginBottom: '4px' }}>
              Action Confirmation Required
            </div>
            <p style={{ fontSize: '12px', color: 'var(--fg)', marginBottom: '8px' }}>
              {confirmationText || 'High-risk action requires human authorization.'}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onConfirm(true)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius)',
                  border: 'none',
                  background: 'var(--success)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onConfirm(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--card-border)',
                  background: 'var(--card-bg)',
                  color: 'var(--fg)',
                  cursor: 'pointer',
                }}
              >
                Deny
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
