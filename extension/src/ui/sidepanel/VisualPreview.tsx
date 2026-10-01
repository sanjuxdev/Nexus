import React from 'react';
import type { PrivacyAudit } from '@contracts/index.js';

interface VisualPreviewProps {
  audit?: PrivacyAudit;
}

export const VisualPreview: React.FC<VisualPreviewProps> = ({ audit }) => {
  if (!audit || !audit.masked_image_url) {
    console.log(`[PRIVACY_RUNTIME_08_PREVIEW_INPUT] source=null`);
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
        No preview available. Start protection to observe the page.
      </div>
    );
  }
  
  console.log(`[PRIVACY_RUNTIME_08_PREVIEW_INPUT] source=sanitized length=${audit.masked_image_url.length}`);

  return (
    <div style={{ padding: '12px', borderBottom: '1px solid var(--card-border)' }}>
      <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--fg)' }}>
        Sanitized Page Preview
      </div>
      <div style={{
        position: 'relative',
        width: '100%',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        border: '1px solid var(--card-border)',
        backgroundColor: '#1e1e1e'
      }}>
        <img 
          src={audit.masked_image_url} 
          alt="Masked Preview" 
          style={{ width: '100%', display: 'block', objectFit: 'contain' }}
        />
      </div>
      <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--fg)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Detected Sensitive Regions:</span>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{audit.stats.total_redactions}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Protected Area (Pixels):</span>
          <span style={{ fontWeight: 600 }}>{audit.stats.masked_area_px.toLocaleString()} px²</span>
        </div>
      </div>
    </div>
  );
};
