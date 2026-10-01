export function isElementVisible(el: Element): boolean {
  if (typeof (el as any).checkVisibility === 'function') {
    if (
      !(el as any).checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
    ) {
      return false;
    }
  }

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  if (typeof window !== 'undefined') {
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      parseFloat(style.opacity || '1') < 0.05
    ) {
      return false;
    }
  }

  return true;
}

export function isElementInViewport(rect: DOMRect | { top: number; left: number; bottom: number; right: number }, viewport: { w: number; h: number }): boolean {
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= viewport.h &&
    rect.left <= viewport.w
  );
}

export function isElementOccluded(el: Element, cx: number, cy: number): boolean {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
    return false;
  }
  const topElements = document.elementsFromPoint(cx, cy);
  if (topElements.length === 0) return false;

  const top = topElements[0];
  if (!top) return false;

  // If the top element is our element or one of its descendants, it is not occluded
  return top !== el && !el.contains(top);
}
