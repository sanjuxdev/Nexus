import React, { useState } from 'react';

interface RouteItem {
  region_key: string;
  level: string;
  reasons: string[];
}

interface RouteViewProps {
  routes: RouteItem[];
}

export const RouteView: React.FC<RouteViewProps> = ({ routes }) => {
  const [expanded, setExpanded] = useState(false);

  const highCount = routes.filter((r) => r.level === 'HIGH').length;
  const medCount = routes.filter((r) => r.level === 'MEDIUM').length;
  const lowCount = routes.filter((r) => r.level === 'LOW').length;

  return (
    <div style={{ padding: '12px', borderBottom: '1px solid var(--card-border)' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Confidence Router ({routes.length} Regions)
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--success)' }}>H:{highCount}</span>
          <span style={{ fontSize: '11px', color: 'var(--warning)' }}>M:{medCount}</span>
          <span style={{ fontSize: '11px', color: 'var(--danger)' }}>L:{lowCount}</span>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '8px', maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {routes.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>No routed regions yet</div>
          ) : (
            routes.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)',
                  fontSize: '11px',
                }}
              >
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span
                    style={{
                      fontWeight: 600,
                      padding: '1px 4px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      background:
                        r.level === 'HIGH'
                          ? 'rgba(34, 197, 94, 0.15)'
                          : r.level === 'MEDIUM'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                      color:
                        r.level === 'HIGH'
                          ? 'var(--success)'
                          : r.level === 'MEDIUM'
                          ? 'var(--warning)'
                          : 'var(--danger)',
                    }}
                  >
                    {r.level}
                  </span>
                  <span style={{ fontFamily: 'monospace' }}>{r.region_key}</span>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: '10px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reasons.join(', ')}>
                  {r.reasons.join(', ') || 'html element'}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
