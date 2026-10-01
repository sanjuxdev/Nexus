# Original User Request

## 2026-09-23T01:24:18+05:30

Diagnose and fix face detection performance and accuracy for SIH 2026 Problem Statement 26171 (On-device Visual Perception). The face detector processes static screenshots locally.

Working directory: ~/teamwork_projects/sih_face_detection
Integrity mode: benchmark

## Requirements

### R1. Understand Current Pipeline
Analyze the complete image-processing pipeline (source, dimensions, model, backend, latency, redaction coordinates). Do not change code before this investigation.

### R2. Reproduce Failure using Static Images
Create a deterministic test set (10 tests: single face, multiple faces, small, large, partial, side-profile, webpage screenshot, image element, dynamic render, no-face). Record detections, confidence, bboxes, latency, and dimensions.

### R3. Determine Failure Category
Classify the failure (A: Model fails, B: Bounding box wrong, C: Detected sometimes, D: Too slow) and investigate the root cause accordingly.

### R4. Optimize Resolution and Model
Benchmark controlled perception resolutions (e.g., 640x360) while preserving original dimensions for coordinate mapping. Evaluate lightweight face detectors and quantization formats (INT8, FP16, FP32). Initialize the model once and reuse the session.

### R5. Resource Optimization and Coordinate Transformation
Optimize hardware utilization (CPU, GPU, RAM, VRAM). Minimize image memory copies and batch sizes. Implement correct screenshot coordinate transformations from detector input back to original dimensions. Ensure complete redaction coverage. Implement CPU fallback if GPU fails. Do not break existing DOM perception.

## Acceptance Criteria

### Verification
- [ ] Static images are detected reliably.
- [ ] Multiple faces work.
- [ ] Small faces are tested.
- [ ] Bounding boxes are correct.
- [ ] Screenshot coordinate mapping is correct.
- [ ] Redaction completely covers detected faces.
- [ ] No unnecessary model reload occurs.
- [ ] CPU, GPU, RAM, and VRAM usage are measured.
- [ ] GPU fallback works.
- [ ] CPU fallback works.
- [ ] No memory leak occurs during repeated image processing.
- [ ] 100-image benchmark completes successfully.
- [ ] P95 perception latency is measured.
- [ ] Complete perception pipeline is benchmarked against the SIH sub-500 ms target.
- [ ] DOM perception remains functional.
- [ ] Browser-agent workflow remains functional.
- [ ] A final report is generated documenting root cause, model, runtime, image stats, performance, accuracy, changes, regression, and remaining issues.
