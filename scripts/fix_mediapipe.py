import re

file_path = "extension/src/vision/engine.ts"
with open(file_path, "r") as f:
    content = f.read()

# Add MediaPipe import
content = content.replace("import Tesseract from 'tesseract.js';", "import Tesseract from 'tesseract.js';\nimport { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';")

# Add init block and variable
init_block = """
let faceDetector: FaceDetector | null = null;

async function initFaceDetector() {
  if (faceDetector) return faceDetector;
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
      delegate: "GPU" // Uses WebGL/WebGPU!
    },
    runningMode: "IMAGE"
  });
  return faceDetector;
}

export const visionEngine = {"""
content = content.replace("export const visionEngine = {", init_block)

# Replace the mock Face Detection block
old_face_mock = """        // Simulating WebGPU Face Detection for the Privacy Engine to intercept
        // Only target avatar/face images, never interactive buttons or canvas controls
        req.dom.elements
          .filter(
            (e) =>
              e.visible &&
              (e.tag === 'img' || e.role === 'img') &&
              e.tag !== 'canvas' &&
              e.tag !== 'button' &&
              e.rendering !== 'canvas' &&
              (e.dom_id === 'user-avatar' ||
                (e as any).id === 'user-avatar' ||
                e.name?.toLowerCase().includes('avatar') ||
                e.name?.toLowerCase().includes('face') ||
                e.name?.toLowerCase().includes('profile') ||
                (e.bbox[2] <= 120 && e.bbox[3] <= 120))
          )
          .forEach((e) => {
             faces.push({
               bbox: e.bbox,
               confidence: 0.98,
             });
          });"""

new_face_mediapipe = """        // True WebGPU Face Detection via MediaPipe Tasks Vision
        try {
          const detector = await initFaceDetector();
          
          // In an Offscreen Document, we can decode the image
          const res = await fetch(req.image_data_url);
          const blob = await res.blob();
          const imgBitmap = await createImageBitmap(blob);
          
          const faceResults = detector.detect(imgBitmap as any);
          
          faceResults.detections.forEach((det: any) => {
            if (det.boundingBox) {
              faces.push({
                bbox: [det.boundingBox.originX, det.boundingBox.originY, det.boundingBox.width, det.boundingBox.height],
                confidence: det.categories[0].score,
              });
            }
          });
          webgpuUsed = true;
        } catch (e) {
          console.error("MediaPipe WebGPU face detection failed:", e);
        }"""
content = content.replace(old_face_mock, new_face_mediapipe)

with open(file_path, "w") as f:
    f.write(content)
