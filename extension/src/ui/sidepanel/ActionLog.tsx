import React from 'react';
import type { ExecResult, StructuredAction, ValidationVerdict } from '@contracts/index.js';

interface ActionLogProps {
  verdict: ValidationVerdict | null;
  action: StructuredAction | null;
  execResult: ExecResult | null;
}

export const ActionLog: React.FC<ActionLogProps> = ({ verdict, action, execResult }) => {
  return (
    <div style={{ padding: '12px', borderBottom: '1px solid var(--card-border)' }}>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '8px' }}>
        Action Firewall & Execution
      </div>

      {action ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '12px' }}>
              {action.action.toUpperCase()} {action.target ? `→ ${action.target.region_id}` : ''}
            </span>
            {verdict && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: verdict.valid ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: verdict.valid ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {verdict.valid ? 'FIREWALL PASSED' : `BLOCKED (${verdict.failed_step})`}
              </span>
            )}
          </div>

          {action.rationale && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic' }}>
              &ldquo;{action.rationale}&rdquo;
            </div>
          )}

          {verdict && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '4px',
                marginTop: '4px',
                padding: '6px',
                borderRadius: 'var(--radius)',
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
              }}
            >
              {verdict.checks.map((chk) => (
                <div
                  key={chk.step}
                  style={{
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: chk.ok ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  <span>{chk.ok ? '✓' : '✗'}</span>
                  <span style={{ color: 'var(--fg)' }}>{chk.step}</span>
                </div>
              ))}
            </div>
          )}

          {execResult && (
            <div
              style={{
                marginTop: '4px',
                fontSize: '11px',
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                borderRadius: '4px',
                background: execResult.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: execResult.ok ? 'var(--success)' : 'var(--danger)',
              }}
            >
              <span>Execution: {execResult.ok ? 'Success' : 'Failed'}</span>
              {execResult.new_page_state_hash && (
                <span style={{ fontFamily: 'monospace' }}>Hash: {execResult.new_page_state_hash.slice(0, 8)}...</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>
          No active actions evaluated
        </div>
      )}
    </div>
  );
};
