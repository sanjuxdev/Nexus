import onnxruntime as ort
session = ort.InferenceSession('/Users/rishis/Desktop/SIH2026_sanjay/extension/public/models/face_detection_yunet_2026may.onnx')
print("Inputs:")
for i in session.get_inputs():
    print(f"{i.name}: {i.shape}")
