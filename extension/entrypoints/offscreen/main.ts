import { bus } from '@contracts/index.js';
import { visionEngine } from '../../src/vision/engine.js';
import { privacyStub } from '../../src/privacy.stub.js';

// Top-level synchronous listeners in offscreen document
bus.on('vision/budget', async () => {
  return visionEngine.getBudget();
});

bus.on('vision/perceive', async (payload) => {
  return visionEngine.perceive(payload);
});

bus.on('vision/release', async (payload) => {
  visionEngine.release(payload.capture_id);
  return { released: true };
});

bus.on('privacy/sanitize', async (payload) => {
  return privacyStub.sanitize(payload);
});

bus.on('privacy/scan-text', async (payload) => {
  return privacyStub.scanOutboundText(payload.text);
});

// Announce readiness to Service Worker
bus.send('offscreen/ready', { ready: true }).catch(() => {});
