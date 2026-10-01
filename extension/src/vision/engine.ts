import * as ort from 'onnxruntime-web/webgpu';
import Tesseract from 'tesseract.js';
import { YuNetVisionEngine } from './yunet/yunet-engine.js';
import { YUNET_STANDARD_CONFIG } from './yunet/yunet-config.js';

let yuNetDetector: YuNetVisionEngine | null = null;
async function getYuNetDetector(): Promise<YuNetVisionEngine> {
  if (!yuNetDetector) {
    const modelPath = typeof chrome !== 'undefined' && chrome.runtime?.getURL 
      ? chrome.runtime.getURL('models/face_detection_yunet_2026may.onnx')
      : '/models/face_detection_yunet_2026may.onnx';
    
    yuNetDetector = new YuNetVisionEngine({
      modelPath,
      inputSize: YUNET_STANDARD_CONFIG.inputSize,
      scoreThreshold: YUNET_STANDARD_CONFIG.scoreThreshold,
      nmsThreshold: YUNET_STANDARD_CONFIG.nmsThreshold,
      topK: YUNET_STANDARD_CONFIG.topK
    });
    await yuNetDetector.initialize();
  }
  return yuNetDetector;
}
import { performSpatialFusion } from './grounding';
import { initUIDetector, detectUIComponents, uiDetectorUsesGpu } from './ui-detection';
import type {
  Budget,
  FaceBox,
  OcrToken,
  PerceptionRegion,
  VisionRequest,
  VisionResult,
  SemanticType,
} from '@contracts/index.js';

// Pre-configure WebGPU execution flags for Phase 3
ort.env.wasm.numThreads = 4;
ort.env.wasm.simd = true;

// Configure WASM paths for the extension context
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('onnx/');
} else {
  ort.env.wasm.wasmPaths = '/onnx/';
}

export const visionEngine = {
  getBudget(): Budget {
    return {
      level: 'HIGH',
      backend: 'webgpu',
      max_vision_regions: 8,
      max_pixels: 1024 * 1024,
      allow_detector: true,
      ocr_mode: 'fast',
    };
  },

  async perceive(req: VisionRequest): Promise<VisionResult> {
    let regions: PerceptionRegion[] = [];
    const ocr_tokens: OcrToken[] = [];
    let faces: FaceBox[] = [];
    let webgpuUsed = false;
    const t0 = performance.now();
    let inferenceMs = 0;
    let ocrMs = 0;

    // Phase 3: Hardware-Accelerated Face & UI Detection via ONNX WebGPU / MediaPipe
    if (req.image_data_url) {
      try {
        // 1. Try local YuNet Face Detection
        try {
          const detector = await getYuNetDetector();
          if (detector) {
            // Decode image without network requests (Invariant I5)
            const base64Data = (req.image_data_url || '').split(',')[1] || '';
            if (base64Data && typeof atob !== 'undefined') {
              const binaryStr = atob(base64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }

              const mimeMatch = req.image_data_url.match(/^data:([^;,]+)/);
              const mimeType = (mimeMatch?.[1] || 'image/png') as string;
              const blob = new Blob([bytes], { type: mimeType });

              if (typeof createImageBitmap !== 'undefined') {
                const imgBitmap = await createImageBitmap(blob);
                const bitmapW = imgBitmap.width;
                const bitmapH = imgBitmap.height;

                const dpr = req.capture?.dpr ?? 1;
                const viewportW = req.capture?.viewport?.w ?? bitmapW / dpr;
                const viewportH = req.capture?.viewport?.h ?? bitmapH / dpr;
                const scaleX = viewportW / bitmapW;
                const scaleY = viewportH / bitmapH;

                // Phase 3: Extract selective bounding boxes for high-res YuNet tiling
                const selectiveRegions: { x: number; y: number; w: number; h: number }[] = [];
                if (req.dom?.elements) {
                  for (const el of req.dom.elements) {
                    if (
                      el.tag === 'img' ||
                      el.tag === 'canvas' ||
                      el.tag === 'video' ||
                      el.has_bg_image ||
                      (el.classes && el.classes.some(c => c.toLowerCase().includes('avatar') || c.toLowerCase().includes('profile')))
                    ) {
                      selectiveRegions.push({
                        x: Math.max(0, el.bbox[0] / scaleX),
                        y: Math.max(0, el.bbox[1] / scaleY),
                        w: Math.min(bitmapW, el.bbox[2] / scaleX),
                        h: Math.min(bitmapH, el.bbox[3] / scaleY)
                      });
                    }
                  }
                }

                const tInfer0 = performance.now();
                faces = await detector.detect(imgBitmap, scaleX, scaleY, selectiveRegions);
                inferenceMs = performance.now() - tInfer0;

                imgBitmap.close();
                webgpuUsed = detector.usesGpu;
              }
            }
          }
        } catch (e) {
          console.warn('[VisionEngine] YuNet face detection failed or unavailable:', e);
        }

        // 2. Try ONNX UI Component Detection (Phase 2)
        try {
          const uiDetector = await initUIDetector();
          if (uiDetector && typeof createImageBitmap !== 'undefined') {
            const base64Data = (req.image_data_url || '').split(',')[1] || '';
            if (base64Data && typeof atob !== 'undefined') {
              const binaryStr = atob(base64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const mimeMatch = req.image_data_url.match(/^data:([^;,]+)/);
              const mimeType = (mimeMatch?.[1] || 'image/png') as string;
              const blob = new Blob([bytes], { type: mimeType });

              const imgBitmap = await createImageBitmap(blob);
              const bitmapW = imgBitmap.width;
              const bitmapH = imgBitmap.height;

              const dpr = req.capture?.dpr ?? 1;
              const viewportW = req.capture?.viewport?.w ?? bitmapW / dpr;
              const viewportH = req.capture?.viewport?.h ?? bitmapH / dpr;
              const scaleX = viewportW / bitmapW;
              const scaleY = viewportH / bitmapH;

              const tInferUi = performance.now();
              const uiComponents = await detectUIComponents(uiDetector, imgBitmap, scaleX, scaleY);
              const uiMs = performance.now() - tInferUi;
              inferenceMs += uiMs;

              uiComponents.forEach((comp, idx) => {
                regions.push({
                  region_id: `ui_comp_${idx}`,
                  local_key: `ui_${comp.label}_${idx}`,
                  dom_ref: null,
                  source: ['VISION'],
                  semantic_type: comp.label as SemanticType,
                  text: null,
                  bbox: comp.bbox,
                  confidence: comp.confidence,
                  visible: true,
                  interactable: true,
                  visual_state: ['visible', 'enabled'],
                  route: 'HIGH',
                  sensitivity: 'none',
                  origin: req.dom.url_origin,
                  frame_id: 'main',
                  page_state_hash: req.dom.page_state_hash,
                  timestamp: Date.now(),
                });
              });

              imgBitmap.close();
              if (uiDetectorUsesGpu) webgpuUsed = true;
            }
          }
        } catch (e) {
          console.warn('[VisionEngine] ONNX UI Component detection failed:', e);
        }

        // NOTE: The DOM-element fallback that previously pushed every <img> element
        // into the faces array has been intentionally removed. That code caused
        // aggressive false-positive redaction (profile icons, logos, decorative images)
        // and violated the surgical-precision requirement described in SANITIZATION_MAP.md.
        // Face redaction now relies exclusively on the MediaPipe model's output.

      } catch (e) {
        console.warn('[VisionEngine] Vision inference failed, falling back...', e);
      }
      
      // Phase 2/3: OCR Integration for precise micro-bounding boxes
      // Note: In Chrome Extension MV3, Tesseract remote CDN workers violate extension CSP.
      // We safely bypass remote CDN loading unless explicitly configured with local worker paths.
      if (typeof Worker !== 'undefined' && (globalThis as any).__ENABLE_LOCAL_OCR__) {
        try {
          const tOcr0 = performance.now();
          const result = await Tesseract.recognize(req.image_data_url, 'eng', {
            logger: () => {} // Mute logger
          });
          ocrMs = performance.now() - tOcr0;
          
          (result.data as any)?.words?.forEach((word: any, index: number) => {
            const bbox: [number, number, number, number] = [word.bbox.x0, word.bbox.y0, word.bbox.x1 - word.bbox.x0, word.bbox.y1 - word.bbox.y0];
            ocr_tokens.push({
              text: word.text,
              bbox: bbox,
              confidence: word.confidence / 100,
              line_id: word.line?.id || index
            });
            
            regions.push({
              region_id: `ocr_reg_${index}`,
              local_key: `ocr_${index}`,
              dom_ref: null,
              source: ['OCR', 'VISION'],
              semantic_type: 'text',
              text: word.text,
              bbox: bbox,
              confidence: word.confidence / 100,
              visible: true,
              interactable: false,
              visual_state: ['visible', 'enabled'],
              route: 'LOW',
              sensitivity: 'none',
              origin: req.dom.url_origin,
              frame_id: 'main',
              page_state_hash: req.dom.page_state_hash,
              timestamp: Date.now(),
            });
          });
        } catch (e) {
          console.warn("Tesseract OCR skipped in this context:", e);
        }
      }
    }

    const totalMs = performance.now() - t0;

    // Apply IoU Spatial Fusion
    const domRegions = (req as any).dom?.regions || [];
    const fusedRegions = performSpatialFusion(domRegions, regions, ocr_tokens, 0.5);

    console.log(`[PERCEPTION] VisionEngine perceive returning faces: ${faces.length}`);

    return {
      cycle_id: req.cycle_id,
      capture_id: req.capture?.capture_id || `cap_${Date.now()}`,
      regions: fusedRegions,
      ocr_tokens,
      faces,
      unresolved: [],
      stats: {
        backend: webgpuUsed ? 'webgpu' : 'wasm',
        models: [{ name: 'vision-engine-v3', version: '0.3.1' }],
        vision_calls: 1,
        ocr_calls: ocrMs > 0 ? 1 : 0,
        pixels_processed: req.capture?.image
          ? req.capture.image.w * req.capture.image.h
          : 1024 * 768,
        cache_hits: 0,
        cache_misses: 1,
        escalated: [],
        timings_ms: {
          total:     Math.round(totalMs    * 10) / 10,
          inference: inferenceMs > 0 ? Math.round(inferenceMs * 10) / 10 : undefined,
          ocr:       ocrMs       > 0 ? Math.round(ocrMs       * 10) / 10 : undefined,
        },
      },
    };
  },

  release(_captureId: string): void {
    // Release capture buffers
  },
};

export const visionStub = visionEngine;
