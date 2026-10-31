import * as ort from 'onnxruntime-web/webgpu';
import Tesseract from 'tesseract.js';
import { extractTextFromImage, reconstructTextWithSpacing } from './ocr-processor.js';
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
      
      // Phase 2/3: OCR Integration for image-based PII detection
      // Extract text from images, documents, and screenshots for privacy analysis
      // Run OCR when there are image elements OR when on document viewer domains
      const hasImageElements = req.dom?.elements?.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'canvas' ||
            el.tag === 'img' ||
            el.tag === 'canvas' ||
            el.tag === 'embed' ||
            el.has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 2500 // Minimum 50x50px threshold (lowered from 100x100)
      );
      
      // Always run OCR on known document viewer domains where PII is likely
      const isDocumentViewerDomain = /(?:scribd\.com|docs\.google\.com|drive\.google\.com|pdf|document)/i.test(
        req.dom?.url_origin || ''
      );
      
      const shouldRunOcr = (hasImageElements || isDocumentViewerDomain) && req.image_data_url;
      
      console.log(`[OCR_ACTIVATION] hasImageElements=${hasImageElements}, isDocumentViewerDomain=${isDocumentViewerDomain}, hasScreenshot=${!!req.image_data_url}, willRunOcr=${shouldRunOcr}`);
      if (!shouldRunOcr && req.image_data_url) {
        console.warn(`[OCR_SKIPPED] Screenshot exists but OCR not triggered. Domain: ${req.dom?.url_origin}, Image elements found: ${req.dom?.elements?.filter(el => el.visible && el.in_viewport && (el.tag === 'img' || el.tag === 'canvas')).length || 0}`);
      }

      if (shouldRunOcr) {
        try {
          const tOcr0 = performance.now();
          const viewport = req.capture?.viewport || { w: 1280, h: 800 };
          
          let imgBitmap: ImageBitmap | null = null;
          let scaleX = 1;
          let scaleY = 1;

          try {
            const base64Data = (req.image_data_url || '').split(',')[1] || '';
            if (base64Data && typeof atob !== 'undefined' && typeof createImageBitmap !== 'undefined') {
              const binaryStr = atob(base64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
              const mimeMatch = req.image_data_url.match(/^data:([^;,]+)/);
              const blob = new Blob([bytes], { type: mimeMatch?.[1] || 'image/png' });
              imgBitmap = await createImageBitmap(blob);
              const dpr = req.capture?.dpr ?? 1;
              const viewportW = req.capture?.viewport?.w ?? imgBitmap.width / dpr;
              const viewportH = req.capture?.viewport?.h ?? imgBitmap.height / dpr;
              scaleX = viewportW / imgBitmap.width;
              scaleY = viewportH / imgBitmap.height;
            }
          } catch {}

          // Focused 2x high-resolution OCR for document/card image elements
          const candidateImageElements = (req.dom?.elements || []).filter(
            (el) =>
              el.visible &&
              el.in_viewport &&
              (el.tag === 'img' || el.tag === 'canvas' || el.tag === 'embed' || el.has_bg_image || el.rendering === 'img' || el.rendering === 'canvas') &&
              el.bbox[2] >= 80 && el.bbox[3] >= 50
          );

          if (imgBitmap && candidateImageElements.length > 0 && typeof OffscreenCanvas !== 'undefined') {
            candidateImageElements.sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]));
            for (const el of candidateImageElements.slice(0, 3)) {
              try {
                const [elX, elY, elW, elH] = el.bbox;
                const targetW = elW * 2;
                const targetH = elH * 2;
                const cropCanvas = new OffscreenCanvas(targetW, targetH);
                const cropCtx = cropCanvas.getContext('2d');
                if (!cropCtx) continue;

                const srcX = Math.max(0, elX / scaleX);
                const srcY = Math.max(0, elY / scaleY);
                const srcW = Math.min(imgBitmap.width - srcX, elW / scaleX);
                const srcH = Math.min(imgBitmap.height - srcY, elH / scaleY);
                if (srcW <= 0 || srcH <= 0) continue;

                cropCtx.drawImage(imgBitmap, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

                const cropBlob = await cropCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
                const reader = new FileReader();
                const cropDataUrl = await new Promise<string>((res) => {
                  reader.onloadend = () => res(reader.result as string);
                  reader.readAsDataURL(cropBlob);
                });

                const cropResult = await extractTextFromImage(
                  cropDataUrl,
                  { w: targetW, h: targetH },
                  {
                    languages: ['eng'],
                    mode: 'fast',
                    confidenceThreshold: 25,
                  }
                );

                for (const token of cropResult.tokens) {
                  // Map from 2x canvas back to page viewport coordinates
                  const tokenX = Math.max(0, Math.round(elX + (token.bbox[0] / 2)));
                  const tokenY = Math.max(0, Math.round(elY + (token.bbox[1] / 2)));
                  const tokenW = Math.max(1, Math.min((viewport.w || 1280) - tokenX, Math.round(token.bbox[2] / 2)));
                  const tokenH = Math.max(1, Math.min((viewport.h || 800) - tokenY, Math.round(token.bbox[3] / 2)));
                  if (tokenX < (viewport.w || 1280) && tokenY < (viewport.h || 800) && tokenW > 0 && tokenH > 0) {
                    ocr_tokens.push({
                      ...token,
                      bbox: [tokenX, tokenY, tokenW, tokenH],
                    });
                  }
                }
              } catch (cropErr) {
                console.warn('[VisionEngine] Crop OCR failed on element:', cropErr);
              }
            }
          }

          if (imgBitmap) {
            imgBitmap.close();
          }

          // Fallback to full screenshot OCR if no visual elements or no tokens extracted
          if (ocr_tokens.length === 0) {
            const ocrResult = await extractTextFromImage(
              req.image_data_url,
              viewport,
              {
                languages: ['eng'],
                mode: 'fast',
                confidenceThreshold: 25,
              }
            );
            ocr_tokens.push(...ocrResult.tokens);
          }

          ocrMs = performance.now() - tOcr0;

          // Add OCR regions for PII pipeline
          for (let i = 0; i < ocr_tokens.length; i++) {
            const token = ocr_tokens[i]!;
            regions.push({
              region_id: `ocr_word_${i}`,
              local_key: `ocr_${i}`,
              dom_ref: null,
              source: ['OCR'],
              semantic_type: 'text',
              text: token.text,
              bbox: token.bbox,
              confidence: token.confidence,
              visible: true,
              interactable: false,
              visual_state: ['visible'],
              route: 'MEDIUM',
              sensitivity: 'none',
              origin: req.dom.url_origin,
              frame_id: 'main',
              page_state_hash: req.dom.page_state_hash,
              timestamp: Date.now(),
            });
          }

          console.log(`[VisionEngine] OCR extracted ${ocr_tokens.length} words in ${ocrMs.toFixed(0)}ms`);
        } catch (e) {
          console.warn('[VisionEngine] OCR extraction failed:', e);
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
