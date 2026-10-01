const ALLOWED_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export async function executeKeypress(key: string): Promise<void> {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`Key "${key}" is not in whitelisted allowed keys`);
  }

  const target = document.activeElement || document.body;
  const opts: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
  };

  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  target.dispatchEvent(new KeyboardEvent('keypress', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
}
