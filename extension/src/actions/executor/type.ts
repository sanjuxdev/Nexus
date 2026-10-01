import { showActionHighlight } from '../../content/agent-ui.js';

function setNativeValue(el: HTMLElement, val: string): void {
  const isTextarea = el.tagName.toLowerCase() === 'textarea';
  const prototype = isTextarea
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, val);
  } else {
    (el as any).value = val;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function executeType(el: Element, text: string): Promise<void> {
  const htmlEl = el as HTMLElement;
  htmlEl.focus();

  const rect = el.getBoundingClientRect();
  showActionHighlight([rect.left, rect.top, rect.width, rect.height]);

  setNativeValue(htmlEl, text);

  if ((htmlEl as HTMLInputElement | HTMLTextAreaElement).value !== text) {
    throw new Error('Type action failed: Element value did not update.');
  }
}

export async function executeFillSecret(el: Element, secretValue: string): Promise<void> {
  let ephemeralSecret: string | null = secretValue;

  try {
    const htmlEl = el as HTMLElement;
    htmlEl.focus();

    const rect = el.getBoundingClientRect();
    showActionHighlight([rect.left, rect.top, rect.width, rect.height]);

    setNativeValue(htmlEl, ephemeralSecret);

    if ((htmlEl as HTMLInputElement | HTMLTextAreaElement).value !== ephemeralSecret) {
      throw new Error('Fill secret action failed: Element value did not update.');
    }
  } finally {
    // Invariant I9: Zeroize secret variable immediately
    ephemeralSecret = '0000000000000000';
    ephemeralSecret = null;
  }
}
