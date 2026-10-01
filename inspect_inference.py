import onnx
import numpy as np
import onnxruntime as ort

model_path = 'extension/public/models/face_detection_yunet_2026may.onnx'
session = ort.InferenceSession(model_path)
input_name = session.get_inputs()[0].name
# Dummy input: 1x3x320x320
input_data = np.random.randn(1, 3, 320, 320).astype(np.float32)
results = session.run(None, {input_name: input_data})

output_names = [o.name for o in session.get_outputs()]
for name, res in zip(output_names, results):
    print(f"{name}: {res.shape} | min: {res.min():.4f}, max: {res.max():.4f}")
