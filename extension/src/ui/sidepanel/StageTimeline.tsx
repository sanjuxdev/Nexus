import React from 'react';
import type { OrchestratorState } from '@contracts/index.js';

interface StageTimelineProps {
  state: OrchestratorState;
  stepIndex: number;
}

const STAGES: OrchestratorState[] = [
  'PERCEIVING',
  'ROUTING',
  'VISION',
  'ASSEMBLING',
  'SANITIZING',
  'PLANNING',
  'VALIDATING',
  'EXECUTING',
  'SETTLING',
];

export const StageTimeline: React.FC<StageTimelineProps> = ({ state, stepIndex }) => {
  const currentIndex = STAGES.indexOf(state);

  return (
    <div style={{ padding: '12px', borderBottom: '1px solid var(--card-border)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          State Machine (Step {stepIndex})
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: '4px',
            background:
              state === 'DONE'
                ? 'rgba(34, 197, 94, 0.15)'
                : state === 'FAILED' || state === 'BLOCKED_BY_PRIVACY' || state === 'SERVER_UNAVAILABLE'
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(37, 99, 235, 0.15)',
            color:
              state === 'DONE'
                ? 'var(--success)'
                : state === 'FAILED' || state === 'BLOCKED_BY_PRIVACY' || state === 'SERVER_UNAVAILABLE'
                ? 'var(--danger)'
                : 'var(--accent)',
          }}
        >
          {state}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '4px' }}>
        {STAGES.map((st, idx) => {
          const isActive = st === state;
          const isPast = currentIndex > idx;
          return (
            <div
              key={st}
              title={st}
              style={{
                height: '6px',
                borderRadius: '2px',
                background: isActive
                  ? 'var(--accent)'
                  : isPast
                  ? 'rgba(37, 99, 235, 0.4)'
                  : 'var(--card-border)',
                transition: 'background 0.2s ease',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
