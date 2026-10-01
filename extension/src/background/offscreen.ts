let creatingOffscreen: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) {
    return;
  }

  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // Check if offscreen document already exists
  try {
    if (typeof (chrome as any).offscreen?.hasDocument === 'function') {
      const hasDoc = await (chrome as any).offscreen.hasDocument();
      if (hasDoc) {
        return;
      }
    } else if ((chrome.runtime as any).getContexts) {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (contexts.length > 0) {
        return;
      }
    }
  } catch (checkErr) {
    console.warn('[Offscreen] Error checking existing contexts:', checkErr);
  }

  if (creatingOffscreen) {
    await Promise.race([creatingOffscreen, new Promise<void>((r) => setTimeout(r, 1000))]);
    return;
  }

  creatingOffscreen = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['WORKERS', 'BLOBS'] as any,
        justification: 'Local ML model inference (M2) and privacy redaction (M3)',
      });
    } catch (err: any) {
      if (!err.message?.includes('Only a single offscreen document may be created')) {
        console.warn('[Offscreen] Failed to create offscreen document:', err);
      }
    } finally {
      creatingOffscreen = null;
    }
  })();

  await Promise.race([creatingOffscreen, new Promise<void>((r) => setTimeout(r, 1000))]);
}

