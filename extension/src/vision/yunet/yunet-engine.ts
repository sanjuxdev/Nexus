import * as ort from 'onnxruntime-web';
import { preprocessYuNet } from './yunet-preprocess.js';
import { postprocessYuNet, computeIoU, computeIoM } from './yunet-postprocess.js';
import type { YuNetConfig } from './yunet-types.js';
import type { FaceBox } from '@contracts/index.js';

import { FaceTracker } from './tracker.js';

export class YuNetVisionEngine {
  private session: ort.InferenceSession | null = null;
  private config: YuNetConfig;
  public usesGpu = false;
  private tracker = new FaceTracker();

  constructor(config: YuNetConfig) {
    this.config = config;
  }

  /**
   * Initializes the ONNX inference session. (Lifecycle managed once)
   */
  async initialize(): Promise<void> {
    if (this.session) return;

    // Point ONNX Runtime to the bundled WASM files in the extension (only in browser)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      ort.env.wasm.wasmPaths = chrome.runtime.getURL('/onnx/');
    } else if (typeof window !== 'undefined') {
      ort.env.wasm.wasmPaths = '/onnx/';
    }
    
    const t0 = performance.now();
    this.session = await ort.InferenceSession.create(this.config.modelPath, {
      executionProviders: ['wasm']
    });
    console.log(`[YuNet] Model Initialization Time: ${(performance.now() - t0).toFixed(2)}ms`);
  }

  /**
   * Releases resources.
   */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }

  /**
   * Runs the complete YuNet face detection pipeline.
   */
  async detect(
    imgBitmap: ImageBitmap, 
    scaleX: number, 
    scaleY: number, 
    selectiveRegions?: {x: number, y: number, w: number, h: number}[]
  ): Promise<FaceBox[]> {
    if (!this.session) {
      throw new Error('YuNetVisionEngine not initialized');
    }

    const tStart = performance.now();
    let allRawFaces: FaceBox[] = [];

    // --- Pass A: Full-frame detection ---
    const { tensor: inputTensor, metadata } = await preprocessYuNet(imgBitmap, this.config.inputSize[0], this.config.inputSize[1]);
    const tPreA = performance.now();

    try {
      const feeds: Record<string, ort.Tensor> = {};
      feeds[this.session.inputNames[0]!] = inputTensor;
      const results = await this.session.run(feeds);
      console.log('[YuNet Debug] ONNX Output Shapes:', Object.keys(results).map(k => `${k}: ${results[k]?.dims}`));
      allRawFaces.push(...postprocessYuNet(results, this.config, metadata));
    } finally {
      inputTensor.dispose();
    }
    const tInferA = performance.now();

    // --- Pass B: Selective higher-resolution/tiled pass ---
    let tileCount = 0;
    const tileW = this.config.inputSize[0];
    const tileH = this.config.inputSize[1];
    const MAX_TILES = 64;

    if (selectiveRegions && selectiveRegions.length > 0) {
      for (const reg of selectiveRegions) {
        if (tileCount >= MAX_TILES) break;

        // Ensure safe bounds
        const sx = Math.max(0, Math.floor(reg.x));
        const sy = Math.max(0, Math.floor(reg.y));
        const sw = Math.min(imgBitmap.width - sx, Math.ceil(reg.w));
        const sh = Math.min(imgBitmap.height - sy, Math.ceil(reg.h));

        if (sw <= 16 || sh <= 16) continue; // Too small to crop reliably

        // If the region itself is larger than the detector, we might tile it. 
        // But for most images, we can just run the detector on the whole region to upscale small faces!
        const stepX = Math.round(tileW * 0.6);
        const stepY = Math.round(tileH * 0.6);

        for (let y = sy; y < sy + sh; y += stepY) {
          for (let x = sx; x < sx + sw; x += stepX) {
            if (tileCount >= MAX_TILES) break;

            let tw = Math.min(tileW, sx + sw - x);
            let th = Math.min(tileH, sy + sh - y);
            // If it's the last tiny sliver, maybe just expand it if possible
            if (tw < 32 && x > sx) { x = sx + sw - tileW; tw = tileW; }
            if (th < 32 && y > sy) { y = sy + sh - tileH; th = tileH; }

            const finalX = Math.max(0, x);
            const finalY = Math.max(0, y);
            const finalW = Math.min(imgBitmap.width - finalX, tw);
            const finalH = Math.min(imgBitmap.height - finalY, th);

            if (finalW <= 16 || finalH <= 16) continue;

            const tileBitmap = await createImageBitmap(imgBitmap, finalX, finalY, finalW, finalH);
            const { tensor: tileTensor, metadata: tileMeta } = await preprocessYuNet(tileBitmap, tileW, tileH);

            try {
              const tileFeeds: Record<string, ort.Tensor> = {};
              tileFeeds[this.session.inputNames[0]!] = tileTensor;
              const tileResults = await this.session.run(tileFeeds);
              const tileFaces = postprocessYuNet(tileResults, this.config, tileMeta);

              for (const f of tileFaces) {
                // Clip the face bounding box to the boundaries of this specific tile
                // This prevents masks from bleeding into neighboring images
                const clipLeft = Math.max(0, -f.bbox[0]);
                const clipTop = Math.max(0, -f.bbox[1]);
                
                const nx = f.bbox[0] + clipLeft;
                const ny = f.bbox[1] + clipTop;
                const nw = Math.min(finalW - nx, f.bbox[2] - clipLeft);
                const nh = Math.min(finalH - ny, f.bbox[3] - clipTop);

                if (nw > 4 && nh > 4) {
                  allRawFaces.push({
                    ...f,
                    bbox: [
                      nx + finalX,
                      ny + finalY,
                      nw,
                      nh
                    ]
                  });
                }
              }
            } finally {
              tileTensor.dispose();
              tileBitmap.close();
            }
            tileCount++;
          }
        }
      }
    }
    const tInferB = performance.now();

    // --- Pass C: Merge & NMS ---
    allRawFaces.sort((a, b) => b.confidence - a.confidence);
    const keptFaces: FaceBox[] = [];
    const active = new Array(allRawFaces.length).fill(true);

    for (let i = 0; i < allRawFaces.length; i++) {
      if (!active[i]) continue;
      const cand = allRawFaces[i]!;
      keptFaces.push(cand);

      if (keptFaces.length >= this.config.topK) break;

      for (let j = i + 1; j < allRawFaces.length; j++) {
        if (active[j]) {
          const iou = computeIoU(cand.bbox, allRawFaces[j]!.bbox);
          const iom = computeIoM(cand.bbox, allRawFaces[j]!.bbox);
          // If boxes overlap heavily OR one is highly contained within the other, they are the same face
          if (iou > this.config.nmsThreshold || iom > 0.8) {
            active[j] = false;
          }
        }
      }
    }

    // Transform into CSS/viewport coordinate space as required by the privacy engine
    let faces = keptFaces.map(f => ({
      ...f,
      bbox: [
        Math.round(f.bbox[0] * scaleX),
        Math.round(f.bbox[1] * scaleY),
        Math.round(f.bbox[2] * scaleX),
        Math.round(f.bbox[3] * scaleY)
      ] as [number, number, number, number]
    }));

    // Pass C2: Temporal tracking
    faces = this.tracker.update(faces);

    const tPost = performance.now();
    
    console.log(`[YuNet] Multi-scale Inference complete. Total: ${(tPost - tStart).toFixed(2)}ms, Pass A: ${(tInferA - tStart).toFixed(2)}ms, Pass B: ${(tInferB - tInferA).toFixed(2)}ms, Merge & Track: ${(tPost - tInferB).toFixed(2)}ms. Faces detected: ${faces.length}`);
    return faces;
  }
}
