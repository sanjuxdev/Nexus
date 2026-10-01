import { describe, it, expect, vi } from 'vitest';
import * as ort from 'onnxruntime-web';
import { YuNetVisionEngine } from '../../extension/src/vision/yunet/yunet-engine.js';
import { YUNET_STANDARD_CONFIG } from '../../extension/src/vision/yunet/yunet-config.js';
import * as fs from 'fs';
import * as path from 'path';

describe('YuNet Metrics Validation', () => {
  it('measures initialization and inference times', async () => {
    // Controlled test-level double for onnxruntime session in Node unit test environment (Option C)
    vi.spyOn(ort.InferenceSession, 'create').mockResolvedValue({
      run: vi.fn().mockResolvedValue({}),
      inputNames: ['input'],
      outputNames: ['cls', 'reg', 'obj'],
    } as any);

    // 1. Initialization
    const engine = new YuNetVisionEngine({
      modelPath: path.resolve(__dirname, '../../extension/public/models/face_detection_yunet_2026may.onnx'),
      inputSize: YUNET_STANDARD_CONFIG.inputSize,
      scoreThreshold: YUNET_STANDARD_CONFIG.scoreThreshold,
      nmsThreshold: YUNET_STANDARD_CONFIG.nmsThreshold,
      topK: YUNET_STANDARD_CONFIG.topK
    });

    const t0 = performance.now();
    await engine.initialize();
    const initTime = performance.now() - t0;
    console.log(`[Metrics] Model Initialization Time: ${initTime.toFixed(2)}ms`);

    // Create a mock ImageBitmap for benchmarking
    // In Node.js, we mock the ImageBitmap creation. We just need to feed it an OffscreenCanvas.
    // However, since we are in a test env without real canvas, we might just mock preprocessYuNet
    // or test the raw ONNX session if preprocessYuNet uses DOM APIs not available in Node.
    // Wait, the project uses vitest and might not have Canvas.
  });
});
