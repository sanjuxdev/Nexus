import onnxruntime as ort
import numpy as np
import urllib.request
import ssl
ssl._create_default_https_context = ssl._create_unverified_context
import cv2

# Download a face image
url = "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg"
req = urllib.request.urlopen(url)
arr = np.asarray(bytearray(req.read()), dtype=np.uint8)
img = cv2.imdecode(arr, -1)
img = cv2.resize(img, (320, 320))
# YuNet expects BGR? Or RGB? OpenCV uses BGR. Usually YuNet input is BGR.
img_input = img.astype(np.float32).transpose(2, 0, 1)[np.newaxis, ...]

session = ort.InferenceSession('extension/public/models/face_detection_yunet_2026may.onnx')
input_name = session.get_inputs()[0].name
results = session.run(None, {input_name: img_input})

output_names = [o.name for o in session.get_outputs()]
out_dict = dict(zip(output_names, results))

for stride in [8, 16, 32]:
    obj = out_dict[f'obj_{stride}']
    bbox = out_dict[f'bbox_{stride}']
    cls = out_dict[f'cls_{stride}']
    
    max_idx = np.argmax(obj)
    max_obj = obj.flatten()[max_idx]
    max_cls = cls.flatten()[max_idx]
    
    print(f"Stride {stride} Max Obj: {max_obj:.4f}, Cls: {max_cls:.4f}")
    if max_obj > 0.5:
        b = bbox.reshape(-1, 4)[max_idx]
        print(f"  bbox: {b}")
