const ort = require('onnxruntime-node');
async function main() {
  const session = await ort.InferenceSession.create('/Users/rishis/Desktop/SIH2026_sanjay/extension/public/models/face_detection_yunet_2026may.onnx');
  console.log("Inputs:", session.inputNames);
  console.log("Outputs:", session.outputNames);
  
  // Create a dummy tensor
  const input = new ort.Tensor('float32', new Float32Array(1 * 3 * 320 * 320), [1, 3, 320, 320]);
  const feeds = {};
  feeds[session.inputNames[0]] = input;
  const results = await session.run(feeds);
  
  for (const key of Object.keys(results)) {
    console.log(`${key}: ${results[key].dims}`);
  }
}
main().catch(console.error);
