let heartbeatInterval: any = null;

export function startKeepalive(): void {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getPlatformInfo) {
      chrome.runtime.getPlatformInfo(() => {
        // No-op API call keeps service worker awake
      });
    }
  }, 20000);
}

export function stopKeepalive(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
