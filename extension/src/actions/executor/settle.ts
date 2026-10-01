export async function waitForSettle(debounceMs = 150, maxWaitMs = 2000): Promise<void> {
  if (typeof document === 'undefined') return;

  return new Promise((resolve) => {
    let timeout: any = null;
    let maxTimeout: any = null;

    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(done, debounceMs);
    });

    const done = () => {
      observer.disconnect();
      clearTimeout(timeout);
      clearTimeout(maxTimeout);
      resolve();
    };

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    timeout = setTimeout(done, debounceMs);
    maxTimeout = setTimeout(done, maxWaitMs);
  });
}
