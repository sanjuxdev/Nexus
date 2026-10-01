const attachedTabs = new Set<number>();

export async function attachDebugger(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return;
  if (typeof chrome === 'undefined' || !chrome.debugger) return;
  
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message?.includes('attached')) {
          attachedTabs.add(tabId);
          resolve();
        } else {
          reject(chrome.runtime.lastError);
        }
      } else {
        attachedTabs.add(tabId);
        resolve();
      }
    });
  });
}

export async function dispatchNativeClick(tabId: number, x: number, y: number): Promise<void> {
  await attachDebugger(tabId);
  if (typeof chrome === 'undefined' || !chrome.debugger) return;

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      { tabId },
      'Input.dispatchMouseEvent',
      {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      },
      () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        chrome.debugger.sendCommand(
          { tabId },
          'Input.dispatchMouseEvent',
          {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1,
          },
          () => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            resolve();
          }
        );
      }
    );
  });
}

export async function dispatchNativeType(tabId: number, text: string): Promise<void> {
  await attachDebugger(tabId);
  if (typeof chrome === 'undefined' || !chrome.debugger) return;

  for (const char of text) {
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.sendCommand(
        { tabId },
        'Input.dispatchKeyEvent',
        {
          type: 'char',
          text: char,
        },
        () => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve();
        }
      );
    });
  }
}
