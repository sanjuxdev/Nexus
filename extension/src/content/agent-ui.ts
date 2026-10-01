import type { BBox } from '@contracts/index.js';

let agentUiContainer: HTMLElement | null = null;
let agentUiShadow: ShadowRoot | null = null;

function ensureAgentUiHost(): ShadowRoot {
  if (agentUiShadow && agentUiContainer && agentUiContainer.isConnected) {
    return agentUiShadow;
  }

  agentUiContainer = document.createElement('div');
  agentUiContainer.setAttribute('data-agent-ui', 'true');
  agentUiContainer.id = '__sih_agent_ui_host__';
  agentUiContainer.style.position = 'fixed';
  agentUiContainer.style.top = '0';
  agentUiContainer.style.left = '0';
  agentUiContainer.style.width = '0';
  agentUiContainer.style.height = '0';
  agentUiContainer.style.zIndex = '2147483647';
  agentUiContainer.style.pointerEvents = 'none';

  agentUiShadow = agentUiContainer.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .action-highlight {
      position: absolute;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.15);
      border-radius: 4px;
      pointer-events: none;
      transition: opacity 0.3s ease-out;
      box-sizing: border-box;
    }
  `;
  agentUiShadow.appendChild(style);

  document.documentElement.appendChild(agentUiContainer);
  return agentUiShadow;
}

/**
 * Show a momentary action highlight bounding box for visual feedback.
 */
export function showActionHighlight(bbox: BBox, durationMs = 800): void {
  if (typeof document === 'undefined') return;

  const shadow = ensureAgentUiHost();
  const box = document.createElement('div');
  box.className = 'action-highlight';
  box.style.left = `${bbox[0]}px`;
  box.style.top = `${bbox[1]}px`;
  box.style.width = `${bbox[2]}px`;
  box.style.height = `${bbox[3]}px`;

  shadow.appendChild(box);

  setTimeout(() => {
    box.style.opacity = '0';
    setTimeout(() => {
      box.remove();
    }, 300);
  }, durationMs);
}
