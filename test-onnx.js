import * as ort from 'onnxruntime-node';
async function run() {
  const session = await ort.InferenceSession.create('extension/public/models/face_detection_yunet_2026may.onnx');
  console.log("Input names:", session.inputNames);
  console.log("Output names:", session.outputNames);
}
run();
