/**
 * Recursively find shadow roots (both open and Chrome-accessible closed roots).
 */
export function getElementShadowRoot(el: Element): {
  root: ShadowRoot | null;
  isClosed: boolean;
} {
  // 1. Standard open shadow root
  if (el.shadowRoot) {
    return { root: el.shadowRoot, isClosed: false };
  }

  // 2. Chrome MV3 chrome.dom.openOrClosedShadowRoot
  if (typeof chrome !== 'undefined' && (chrome as any).dom?.openOrClosedShadowRoot) {
    try {
      const root = (chrome as any).dom.openOrClosedShadowRoot(el);
      if (root) {
        return { root, isClosed: true };
      }
    } catch {
      // Ignored
    }
  }

  return { root: null, isClosed: false };
}
