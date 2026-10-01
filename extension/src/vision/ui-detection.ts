import * as ort from 'onnxruntime-web/webgpu';

let uiDetectorSession: ort.InferenceSession | null = null;
export let uiDetectorUsesGpu = false;

/**
 * Initializes the ONNX UI Component Detector model.
 */
export async function initUIDetector(): Promise<ort.InferenceSession | null> {
  if (uiDetectorSession) return uiDetectorSession;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  let modelPath = '';
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    try {
      // NOTE: We assume a placeholder model name. 
      // Replace with actual model (e.g. YOLO/NanoDet quantized) when available.
      modelPath = chrome.runtime.getURL('models/ui_detector.onnx');
    } catch {}
  } else {
    modelPath = '/models/ui_detector.onnx';
  }

  try {
    let modelResp: Response;
    try {
      const loadLocal = globalThis.fetch;
      modelResp = await loadLocal(modelPath);
    } catch (e) {
      console.debug('[UIDetection] Model not found (this is expected until you drop ui_detector.onnx into public/models/)');
      return null;
    }

    if (!modelResp.ok) {
      console.debug('[UIDetection] Model not found (this is expected until you drop ui_detector.onnx into public/models/)');
      return null;
    }
    const modelBuffer = await modelResp.arrayBuffer();

    try {
      uiDetectorSession = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['webgpu'],
      });
      uiDetectorUsesGpu = true;
    } catch (gpuErr) {
      console.warn('[UIDetection] WebGPU delegate init failed, falling back to WASM:', gpuErr);
      uiDetectorSession = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
      });
      uiDetectorUsesGpu = false;
    }

    return uiDetectorSession;
  } catch (err) {
    console.warn('[UIDetection] ONNX initialization failed:', err);
    return null;
  }
}

export interface UIComponent {
  bbox: [number, number, number, number];
  confidence: number;
  label: string;
}

/**
 * Runs inference on the provided ImageBitmap to detect UI components.
 */
export async function detectUIComponents(
  session: ort.InferenceSession,
  imgBitmap: ImageBitmap,
  scaleX: number,
  scaleY: number
): Promise<UIComponent[]> {
  const components: UIComponent[] = [];
  
  // Standard YOLO input size (change according to actual model specs)
  const inputSize = 640; 
  
  const canvas = new OffscreenCanvas(inputSize, inputSize);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  // Draw and resize image
  ctx.drawImage(imgBitmap, 0, 0, inputSize, inputSize);
  const imageData = ctx.getImageData(0, 0, inputSize, inputSize);
  const data = imageData.data;

  // Preprocess: HWC to CHW format, normalize to float32 (0.0 - 1.0)
  const float32Data = new Float32Array(3 * inputSize * inputSize);
  for (let i = 0; i < inputSize * inputSize; i++) {
    float32Data[i] = data[i * 4]! / 255.0;                         // R
    float32Data[inputSize * inputSize + i] = data[i * 4 + 1]! / 255.0; // G
    float32Data[2 * inputSize * inputSize + i] = data[i * 4 + 2]! / 255.0; // B
  }

  // Create input tensor
  const tensor = new ort.Tensor('float32', float32Data, [1, 3, inputSize, inputSize]);

  try {
    const feeds: Record<string, ort.Tensor> = {};
    const inputName = session.inputNames[0] as string;
    feeds[inputName] = tensor;
    
    // Run ONNX inference
    const output = await session.run(feeds);
    const outputName = session.outputNames[0] as string;
    const outputData = output[outputName]!.data as Float32Array;

    // TODO: The exact post-processing depends heavily on the model architecture (e.g. YOLOv8, YOLO11, SSD).
    // This is a generic placeholder for parsing NMS outputs.
    // It assumes output is [num_boxes, 6] -> [x, y, w, h, conf, class_id]
    
    const numDetections = outputData.length / 6; 
    const classLabels = ['button', 'input', 'icon', 'text_node', 'image'];

    for (let i = 0; i < numDetections; i++) {
      const offset = i * 6;
      const confidence = outputData[offset + 4];
      if (confidence !== undefined && confidence > 0.5) { // 50% confidence threshold
        const classId = Math.round(outputData![offset + 5]!);
        const label = classLabels[classId] || 'ui_element';
        
        // Output coordinates usually relative to the 640x640 input, map back to original image
        let bx = (outputData![offset + 0]! / inputSize) * imgBitmap.width;
        let by = (outputData![offset + 1]! / inputSize) * imgBitmap.height;
        let bw = (outputData![offset + 2]! / inputSize) * imgBitmap.width;
        let bh = (outputData![offset + 3]! / inputSize) * imgBitmap.height;

        components.push({
          bbox: [
            Math.round(bx * scaleX),
            Math.round(by * scaleY),
            Math.round(bw * scaleX),
            Math.round(bh * scaleY),
          ],
          confidence: confidence as number,
          label,
        });
      }
    }
  } catch (e) {
    console.warn('[UIDetection] Inference failed:', e);
  }

  return components;
}
