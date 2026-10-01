const ort = require('onnxruntime-node');

async function main() {
  try {
    const session = await ort.InferenceSession.create('extension/public/models/face_detection_yunet_2026may.onnx');
    
    console.log('[YuNet Runtime]');
    
    // Inputs
    console.log(`inputNames=${session.inputNames.join(', ')}`);
    for (const name of session.inputNames) {
      console.log(`inputDims[${name}]=`, session.handler.sessionGetInputGeometry(name));
    }
    
    // Outputs
    console.log(`outputNames=${session.outputNames.join(', ')}`);
    for (const name of session.outputNames) {
      // Unfortunately ort-node might not expose geometry easily, but we can try 
      // or we can run a dummy tensor through to get the output shapes.
    }
    
    // Run dummy input to get output shapes
    const inputShape = [1, 3, 320, 320]; // We can try 320x320 first
    let dummyData = new Float32Array(1 * 3 * 320 * 320);
    const tensor = new ort.Tensor('float32', dummyData, inputShape);
    
    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    
    console.log('Running dummy inference...');
    const results = await session.run(feeds);
    
    for (const name of session.outputNames) {
      console.log(`outputDims[${name}]=`, results[name].dims);
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
