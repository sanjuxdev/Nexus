const ort = require('onnxruntime-node');

async function main() {
  try {
    const session = await ort.InferenceSession.create('extension/public/models/face_detection_yunet_2026may.onnx');
    
    console.log('[YuNet Runtime]');
    
    // Inputs
    console.log(`inputNames=${session.inputNames.join(', ')}`);
    // session.handler doesn't exist, use session.inputNames to get basic info
    
    // Outputs
    console.log(`outputNames=${session.outputNames.join(', ')}`);
    
    // Run dummy input to get output shapes
    // Let's try 320x320 first
    const inputShape = [1, 3, 320, 320];
    let dummyData = new Float32Array(1 * 3 * 320 * 320);
    const tensor = new ort.Tensor('float32', dummyData, inputShape);
    
    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    
    console.log('Running dummy inference...');
    let results = await session.run(feeds);
    
    for (const name of session.outputNames) {
      console.log(`outputDims[${name}]=`, results[name].dims);
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
