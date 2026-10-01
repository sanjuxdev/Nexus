import { showActionHighlight } from '../../content/agent-ui.js';

export async function executeClick(el: Element): Promise<void> {
  // 1. Scroll into view if needed
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // 2. Anti-decoy check: verify element at point is indeed target or descendant
  if (typeof document.elementFromPoint === 'function') {
    const atPoint = document.elementFromPoint(cx, cy);
    if (atPoint && atPoint !== el && !el.contains(atPoint)) {
      throw new Error(`Click blocked: target is obscured by decoy element <${atPoint.tagName.toLowerCase()}>`);
    }
  }

  // 3. Highlight
  showActionHighlight([rect.left, rect.top, rect.width, rect.height]);

  // 4. Dispatch pointer & mouse events
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: cx,
    clientY: cy,
  };

  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));

  if (typeof (el as any).click === 'function') {
    (el as any).click();
  }
}
