import onnxruntime as ort
import numpy as np

session = ort.InferenceSession('/Users/rishis/Desktop/SIH2026_sanjay/extension/public/models/face_detection_yunet_2026may.onnx')
input_name = session.get_inputs()[0].name
dummy_input = np.zeros((1, 3, 320, 320), dtype=np.float32)
outputs = session.run(None, {input_name: dummy_input})

for out_meta, out_data in zip(session.get_outputs(), outputs):
    print(f"{out_meta.name}: {out_data.shape}")
