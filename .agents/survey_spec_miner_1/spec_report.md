# Specification Mining & Requirements Inventory: SIH 2026 PS 26171
**On-Device Visual Perception for Light-Weight Browser Agents — Face Detection Subsystem**

- **Document Version:** 1.0.0
- **Author:** `survey_spec_miner_1` (Specification Mining Subagent)
- **Target Problem Statement:** SIH 2026 Problem Statement 26171 (Catalogue ID: `SIH26171`)
- **Sponsoring Organization:** Indian Space Research Organisation (ISRO), Department of Space, Government of India
- **Repository Location:** `/home/agent-s/Documents/GitHub`
- **Date:** September 23, 2026

---

## 1. Executive Summary & Authoritative Mandate

### 1.1 Context & Problem Statement Definition
Smart India Hackathon (SIH) 2026 Problem Statement 26171, sponsored by ISRO, mandates an **on-device, privacy-preserving visual perception engine** for autonomous browser agents operating within high-security environments (e.g. Bhuvan Geospatial Portal, MOSDAC, internal mission telemetry). 

Unlike conventional cloud-based agent paradigms that transmit raw DOM trees and full-page desktop screenshots to remote Vision-Language Models (e.g., GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro), PS 26171 strictly enforces **Invariant I5 (Zero Data Leakage Boundary)**:
> No cleartext PII, credentials, or raw biometric features (including human faces) may ever leave the client browser. All visual privacy boundaries must be enforced locally on-device via permanent pixel-level canvas blackout prior to network transmission.

### 1.2 Core Architectural Principle: Static Screenshot Face Detection
- **Not a Video/Webcam Detector:** The face detector does NOT process real-time webcam streams or video feeds.
- **Static Browser Screenshots:** The input consists exclusively of **static screenshots or rendered images captured from browser pages** locally.
- **Optimization Target:** Maximum useful perception performance per unit of CPU/GPU/RAM/VRAM while maintaining reliable detection. The detector must coexist harmoniously with DOM perception, OCR, visual grounding, browser rendering, and agent reasoning.

---

## 2. Authoritative Source Documents Index

| Document Path | Role & Authority | Key Contributions Mined |
|---|---|---|
| `/home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md` | Authoritative User Request & Core Constraints | Defined R1–R5, 16 Acceptance Criteria, benchmark integrity mode. |
| `/home/agent-s/Documents/GitHub/tackling face detection.md` | Primary Operational Technical Specification (25 Sections) | Complete 25-section architectural blueprint: pipeline audit, 10 test categories, 4 failure modes, resolution scaling math, quantization matrix, memory rules, sub-500ms latency path, benchmark formats. |
| `/home/agent-s/Documents/GitHub/readme files/ps analysis.md` | SIH Evaluation Rubric & ISRO Mandate | Official 5-dimensional evaluation weightage (D1–D5), national security context, ISRO Edge Trilemma, forensic gap analysis. |
| `/home/agent-s/Documents/GitHub/readme files/02_MEMBER_2_LOCAL_VISION_AND_PERCEPTION.md` | Member 2 Vision Specification | Architecture for ONNX Runtime Web, WebGPU→WebGL→WASM fallback cascade, CaptureStore, coordinate conventions (CSS px vs image px). |
| `/home/agent-s/Documents/GitHub/contracts/ts/vision.ts` | Type Contracts for Vision Subsystem | `FaceBox`, `CaptureMeta`, `VisionRequest`, `VisionResult`, `VisionStats`. |
| `/home/agent-s/Documents/GitHub/extension/src/vision/engine.ts` | Current In-Tree Vision Implementation | MediaPipe BlazeFace short-range TFLite loading, GPU/CPU delegate fallback, DOM heuristic fallback. |
| `/home/agent-s/Documents/GitHub/extension/src/privacy.stub.ts` | Privacy & Redaction Implementation | `redactImageCanvas`, 4px CSS safety padding, OffscreenCanvas 2D solid blackout (`#000000`), `#ef4444` border, `[FACE]` badge. |

---

## 3. Comprehensive Requirements Inventory (R1 – R5)

### R1. Pipeline Understanding & Architectural Auditing Requirements
Before any code modification, the complete image-processing pipeline must be inspected and documented across 15 mandatory parameters:
1. **Input Image Source:** Active browser tab viewport captured via `chrome.tabs.captureVisibleTab` (or synthetic mock canvas).
2. **Input Image Dimensions:** Physical bitmap dimensions ($W_{\text{bitmap}} \times H_{\text{bitmap}}$) vs CSS viewport dimensions ($W_{\text{css}} \times H_{\text{css}}$), linked by `devicePixelRatio` (DPR).
3. **Image Format:** Base64 data URL (`data:image/png;base64,...` or `data:image/jpeg;base64,...`), decoded to `ImageBitmap`, `Blob`, or raw `Uint8Array`.
4. **Image Preprocessing:** Aspect-ratio-preserving resize/letterboxing, downsampling to controlled perception resolution, normalization (0..255 to 0..1 or -1..1), RGB/BGR ordering, NCHW planar float32 tensor conversion.
5. **Model Architecture:** Lightweight single-shot detector (e.g. MediaPipe BlazeFace short-range SSD anchor-based, UltraFace-RFB, or YuNet).
6. **Model Format:** Bundled `.tflite` or `.onnx` binary; static shapes preferred for WebGPU/WASM.
7. **Runtime:** `@mediapipe/tasks-vision` FilesetResolver/WASM engine or `onnxruntime-web/webgpu`.
8. **Backend:** WebGPU execution provider with automatic fallback to WebGL and WASM SIMD / WASM nosimd.
9. **Execution Provider / Hardware:** RTX 3050 GPU (CUDA/DirectML/WebGPU) with seamless fallback to host CPU.
10. **Quantization:** INT8 dynamic/static, FP16, or FP32.
11. **Confidence Threshold:** Configurable detection threshold; benchmarked across grid `[0.30, 0.40, 0.50, 0.60, 0.70]`.
12. **Maximum Faces Limit:** Support multi-face detection (at least 10+ concurrent faces per screenshot) without truncation.
13. **Inference Latency:** Phase-separated timings (`preprocess`, `inference`, `postprocess`, `coord_transform`, `redaction`).
14. **Output Coordinates:** Detector raw output in normalized coordinates $[0..1]$ or detector-pixel coordinates.
15. **Redaction Coordinates:** Transformed back to physical canvas bitmap pixels with 4px safety padding.

### R2. Deterministic Static Test Set Requirements (10 Categories)
The test set must strictly use static images (zero webcam/video dependencies) and cover 10 distinct scenario categories:

| Category ID | Category Name | Visual Description & Objective | Expected Behavior |
|---|---|---|---|
| **CAT-01 (Test 1)** | Single Frontal Face | High-contrast, frontal human face occupying standard avatar area (e.g. 150x150 px). | Exactly 1 face detected, confidence $\ge 0.90$, tight bounding box. |
| **CAT-02 (Test 2)** | Multiple Faces | Group photograph, team roster, or page layout with 3–6 distinct faces. | All faces detected, independent non-overlapping bounding boxes. |
| **CAT-03 (Test 3)** | Small Face | Small face occupying $\le 80 \times 80$ px in a $1920 \times 1080$ screenshot ($\le 0.3\%$ of screen area). | Face successfully detected despite low pixel footprint; requires testing resolution thresholds. |
| **CAT-04 (Test 4)** | Large Face | High-resolution close-up portrait occupying $> 50\%$ of viewport. | Face detected reliably without boundary clipping or box distortion. |
| **CAT-05 (Test 5)** | Partially Visible Face | Face occluded by dialogue, edge of screen, sunglasses, or clothing ($20\%\text{--}50\%$ occluded). | Detect partial face or evaluate graceful boundary handling. |
| **CAT-06 (Test 6)** | Side-Profile Face | Non-frontal face turned at substantial yaw angle ($45^\circ\text{--}90^\circ$). | Detect face profile without dropping below confidence threshold. |
| **CAT-07 (Test 7)** | Webpage Screenshot | Full realistic browser viewport (DOM elements, text, navigation bar, side panel, avatar). | Face detected in layout context without corrupting surrounding text/DOM coords. |
| **CAT-08 (Test 8)** | Image Element | Face embedded inside standard HTML `<img>`, `<picture>`, or `<figure>` container. | Face detected and mapped to image coordinates. |
| **CAT-09 (Test 9)** | Dynamically Rendered Webpage | Face inside dynamic client-side SPA (canvas, WebGL, or CSS-animated element). | Face detected correctly from rendered raster bitmap. |
| **CAT-10 (Test 10)** | Negative Control (No Face) | Webpage containing text, forms, charts, landscape photos, or UI icons with zero human faces. | Exactly 0 faces detected; returns clean zero-detection result without error. |

#### Negative Lookalike Test Criteria (False Positive Prevention):
Test against human-like drawings, profile illustrations, posters, statues, mannequins, and emojis. False positive detections must be tracked and minimized. Zero detections must never throw an error.

### R3. Failure Classification & Root Cause Criteria
All anomalies and failures must be classified into one of four rigid failure categories:

- **Category A: Model Fails to Detect the Face (False Negative / Miss)**
  - *Definition:* Face is clearly present, but detector returns 0 detections or score below threshold.
  - *Root Cause Criteria:* Check model architecture capacity, input tensor format (RGB vs BGR, NCHW vs NHWC), normalization range ($[0..1]$ vs $[-1..1]$ vs $[0..255]$), confidence threshold hyperparameter, runtime WASM/WebGPU initialization failure, quantization artifacts.
- **Category B: Model Detects Face but Bounding Box is Wrong (Spatial Offset)**
  - *Definition:* Face is detected, but coordinates do not align with physical face pixels; redaction appears offset.
  - *Root Cause Criteria:* Check aspect ratio distortion (resizing without letterboxing), devicePixelRatio (DPR) mismatch, CSS pixels vs bitmap physical pixels confusion, canvas coordinate offsets, un-inverted normalized coordinates, missing scroll offsets.
- **Category C: Face is Detected Only Sometimes (Intermittent / Flaky Detection)**
  - *Definition:* Non-deterministic detection across repeated runs or slight image shifts.
  - *Root Cause Criteria:* Confidence threshold hovering right at detector output score, input resolution too low causing sub-pixel feature loss, interpolation algorithm differences (bilinear vs nearest neighbor), quantization precision edge cases.
  - *Rule:* Do NOT immediately swap the model; calibrate threshold and input resolution first.
- **Category D: Face Detection is Accurate but Too Slow (Latency Failure)**
  - *Definition:* Detection works accurately, but complete perception latency exceeds the sub-500ms budget.
  - *Root Cause Criteria:* Model parameter size too large (>5 MB), unquantized FP32 execution, CPU fallback without WASM SIMD, unoptimized perception resolution (feeding raw 1920x1080), redundant memory copies (`Image -> Canvas -> Blob -> ArrayBuffer -> Tensor`), per-inference model reload.

### R4. Resolution Optimization, Quantization & Session Lifecycle

#### 1. Controlled Perception Resolutions
Never feed full-resolution screenshots (e.g. $1920 \times 1080$) directly into the neural network. Benchmark a controlled resolution ladder:
1. $320 \times 180$ (Ultra-low latency, risk of small-face misses)
2. $416 \times 234$ (Balanced lightweight)
3. $512 \times 288$ (High quality)
4. $640 \times 360$ (**Recommended Standard Baseline**)
5. $640 \times 480$ (4:3 aspect ratio alternative)

#### 2. Coordinate Scaling & Inverse Transformation Math
Let $(W_{\text{orig}}, H_{\text{orig}})$ be original image dimensions in CSS or physical pixels, and $(W_{\text{det}}, H_{\text{det}})$ be model input dimensions:
$$S_x = \frac{W_{\text{orig}}}{W_{\text{det}}}, \quad S_y = \frac{H_{\text{orig}}}{H_{\text{det}}}$$
For detector bounding box $[x_{\text{det}}, y_{\text{det}}, w_{\text{det}}, h_{\text{det}}]$:
$$x_{\text{mapped}} = x_{\text{det}} \times S_x, \quad y_{\text{mapped}} = y_{\text{det}} \times S_y$$
$$w_{\text{mapped}} = w_{\text{det}} \times S_x, \quad h_{\text{mapped}} = h_{\text{det}} \times S_y$$
When mapping to physical bitmap with devicePixelRatio ($\text{DPR}$):
$$x_{\text{bitmap}} = x_{\text{css}} \times \text{DPR}, \quad y_{\text{bitmap}} = y_{\text{css}} \times \text{DPR}$$
Ensure safety padding: add at least $4\text{px} \times \text{DPR}$ padding on all sides before rasterizing privacy mask.

#### 3. Lightweight Model Selection & Quantization Formats
- Target model parameter size: $\le 1\text{--}2\text{ MB}$ (e.g. BlazeFace $\approx 230\text{ KB}$, UltraFace $\approx 1.1\text{ MB}$).
- Quantization Matrix Evaluation: Benchmark INT8 vs FP16 vs FP32 across:
  - Model binary file size (MB)
  - Inference latency (ms)
  - Detection accuracy (IoU, precision, recall)
  - Host RAM consumption (MB)
  - GPU VRAM consumption (MB)
- Rule: Do not assume INT8 is automatically superior; select INT8 only if accuracy degradation is negligible.

#### 4. Model Session Lifecycle & Resident Memory
- **Single Initialization Rule:** Initialize model weights and create runtime inference session **ONCE** at extension startup or offscreen worker spawn.
- **Session Reuse:** Keep inference session resident in memory across all screenshot cycles.
- **Prohibited Anti-Pattern:** Loading model file, creating session, and tearing down session per screenshot is strictly forbidden.

### R5. Resource Optimization, Redaction Coverage & System Coexistence

#### 1. Hardware Utilization Bounds
- Optimized for host hardware: NVIDIA RTX 3050 4GB GPU (and standard integrated CPU/GPU).
- Target limits:
  - Peak Client RAM: $< 150\text{ MB}$ (ISRO constraint).
  - Average CPU Utilization: $< 25\%$ on quad-core x86_64 host.
  - VRAM Consumption: Bounded to lightweight perception footprint ($< 250\text{ MB}$); never consume the entire 4GB VRAM.
  - Zero dropped frames on browser main thread.

#### 2. Image Memory Copy Minimization
- Eliminate redundant intermediate object allocations:
  - Unreleased `ImageBitmap` handles.
  - Duplicate `ArrayBuffer` allocations.
  - Base64 encoding/decoding round-trips.
  - Re-allocated WebGPU tensor buffers.
- Enforce explicit `bitmap.close()` and buffer garbage collection after inference.

#### 3. Batching & Queue Management
- Interactive latency takes precedence over throughput: default `batch_size = 1`.
- For background queues, evaluate `batch = 1, 2, 4`.
- **Obsolete Work Dropping:** If a newer screenshot is captured while a previous one is queued, discard the obsolete frame immediately to prevent re-perception backlog death spirals.

#### 4. Pixel-Level Complete Redaction Coverage
- For every detected face:
  - Fill rectangle with solid black `#000000` (zero biometric pixels preserved in memory).
  - Draw bounding border `#ef4444` (crimson red, thickness scaled with DPR).
  - Stamp label badge `[FACE]` or `[REDACTED: FACE | 2D Canvas Blackout]`.
- Complete coverage verification: Must cover faces near left edge, right edge, top edge, bottom edge, small faces, and multiple faces.

#### 5. Hardware Fallback & Error Handling
- Primary: WebGPU / GPU execution provider.
- Fallback 1: WebGL2 on OffscreenCanvas.
- Fallback 2: WASM SIMD.
- Fallback 3: WASM nosimd (CPU).
- On GPU initialization failure or runtime failure: Catch exception and automatically retry on CPU fallback without crashing the extension.
- Model load failure $\to$ explicit descriptive `StageError`.
- Corrupt image $\to$ explicit descriptive `StageError`.
- No face detected $\to$ valid empty detection result (`faces: []`), never an exception.

#### 6. DOM Perception Non-Regression
- Face detection is an independent visual perception channel.
- Must NOT alter or regress:
  - DOM tree extraction & ARIA role resolution.
  - Accessibility name computation.
  - Bounding box extraction of interactive elements.
  - Extension message bus routing (`bus.send`).
  - Action validation firewall & synthetic execution.

---

## 4. Performance & Latency Requirements (SIH Sub-500ms Target)

### 4.1 Complete Perception Path Breakdown
The SIH 26171 sub-500ms mandate applies to the **entire perception path**, not merely raw model inference:
$$T_{\text{perception}} = T_{\text{capture}} + T_{\text{preprocess}} + T_{\text{inference}} + T_{\text{postprocess}} + T_{\text{coord\_transform}} + T_{\text{redaction\_prep}}$$

| Component | Target Latency Budget | Maximum Permissible Latency | Notes |
|---|---|---|---|
| Screenshot Capture ($T_{\text{capture}}$) | $50\text{--}80\text{ ms}$ | $150\text{ ms}$ | Rate-limited by Chrome `captureVisibleTab` quota (~1.25 calls/s). |
| Preprocessing ($T_{\text{preprocess}}$) | $10\text{--}25\text{ ms}$ | $50\text{ ms}$ | Canvas resize, downsampling to 640x360, pixel extraction. |
| Model Inference ($T_{\text{inference}}$) | $15\text{--}45\text{ ms}$ (GPU) / $60\text{--}120\text{ ms}$ (CPU) | $200\text{ ms}$ | ONNX Runtime / MediaPipe on 640x360 input. |
| Postprocessing & NMS ($T_{\text{postprocess}}$) | $5\text{--}15\text{ ms}$ | $30\text{ ms}$ | Anchor decoding, IoU filtering, score thresholding. |
| Coordinate Transform ($T_{\text{coord\_transform}}$) | $< 2\text{ ms}$ | $5\text{ ms}$ | Matrix math back to original CSS and bitmap coordinates. |
| Canvas Redaction ($T_{\text{redaction\_prep}}$) | $15\text{--}35\text{ ms}$ | $60\text{ ms}$ | OffscreenCanvas 2D solid fill, stroke, text label, JPEG export. |
| **Total End-to-End Perception** | **$< 200\text{ ms}$ (GPU) / $< 350\text{ ms}$ (CPU)** | **$< 500\text{ ms}$ (SIH Target)** | **Mandatory SIH 26171 Compliance Limit.** |

### 4.2 Statistical Latency Metrics
Inference and perception measurements must report:
- **Average (Mean):** Overall throughput indicator.
- **P50 (Median):** Typical user experience.
- **P95 (95th Percentile):** Primary service-level objective (SLO) for interactive autonomy.
- **P99 (99th Percentile):** Tail latency outlier detection.
- **Maximum:** Worst-case latency spike.
- Precision: High-resolution timing via `performance.now()` with 3 decimal places.

---

## 5. Benchmark & Memory Leak Detection Requirements

### 5.1 100-Image Benchmark Specification
- Execute at least 100 sequential inferences over representative test images.
- Automated runner CLI command (e.g. `npm run benchmark:face` or dedicated benchmark script).
- Output standardized hardware & performance report card:
```text
================================
FACE DETECTION BENCHMARK
================================
Input:              1920 × 1080 (CSS 1280 × 720, DPR 1.5)
Perception Res:     640 × 360
Model:              BlazeFace Short Range / UltraFace-RFB
Quantization:       INT8 / FP16 / FP32
Backend:            WebGPU / WASM SIMD
Iterations:         100
--------------------------------
Preprocessing:      XX.XXX ms
Inference:          XX.XXX ms
Postprocessing:     XX.XXX ms
Coordinate Map:     XX.XXX ms
Redaction:          XX.XXX ms
Total Perception:   XX.XXX ms
--------------------------------
Latency P50:        XX.XXX ms
Latency P95:        XX.XXX ms
Latency P99:        XX.XXX ms
Latency Max:        XX.XXX ms
--------------------------------
CPU Utilization:    XX.X % (Peak: XX.X %)
GPU Utilization:    XX.X % (Peak: XX.X %)
Host RAM:           XX.X MB (Delta: +X.X MB)
VRAM:               XX.X MB (Delta: +X.X MB)
Faces Detected:     XX
Avg Confidence:     0.XX
Memory Leak Status: PASS (Slope < 0.05 MB/iter)
================================
```

### 5.2 Memory Leak Detection Criteria
- Track `performance.memory.usedJSHeapSize` (or CDP `JSHeapUsedSize`) at iterations 0, 20, 40, 60, 80, and 100.
- Track GPU memory / VRAM consumption across the run.
- **Pass Criteria:** Memory consumption must stabilize within the first 10 warm-up iterations. The linear regression slope across iterations 10 to 100 must be $< 0.05\text{ MB/iteration}$ (demonstrating proper garbage collection and resource disposal).
- Monotonic memory growth constitutes an automatic failure.

---

## 6. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Model Runtime | MediaPipe Face Detection | Lightweight anchor-based SSD detector running BlazeFace short-range model via WASM. | `ImageBitmap`, `ImageData`, or `Blob` | `Detection[]` with bounding box, keypoints, categories | Returns null or falls back to CPU if GPU delegate fails | `extension/src/vision/engine.ts`, `tackling face detection.md §8` |
| 2 | Model Runtime | ONNX Runtime Web Execution | Local ONNX engine supporting WebGPU, WebGL, and WASM SIMD execution providers. | Float32 tensor $[1, 3, H, W]$ | Output tensors (boxes, scores) | Falls back sequentially: WebGPU $\to$ WebGL $\to$ WASM SIMD $\to$ CPU | `readme files/02_MEMBER_2_LOCAL_VISION_AND_PERCEPTION.md §2`, `contracts/ts/vision.ts` |
| 3 | Preprocessing | Controlled Resolution Scaling | Downsamples full screenshot (e.g. 1920x1080) to fixed perception dimensions (e.g. 640x360). | Source image bitmap, target dimensions | Scaled image tensor / bitmap | Drops resolution if budget pressure rises | `tackling face detection.md §4`, `contracts/ts/router.ts` |
| 4 | Coordinate System | Inverse Coordinate Transformation | Maps detector-space bounding boxes back to original CSS and bitmap pixels. | `FaceBox` in detector px, scale factors $S_x, S_y$, DPR | `FaceBox` in CSS pixels $[x, y, w, h]$ | Coordinates clamped to $[0, 0, W_{\text{orig}}, H_{\text{orig}}]$ | `tackling face detection.md §17`, `contracts/ts/geometry.ts` |
| 5 | Redaction Engine | 2D OffscreenCanvas Blackout | Erases detected face pixels in-memory and renders solid black privacy box with red border. | Raw screenshot data URL, bounding boxes, viewport | Sanitized base64 JPEG data URL | Falls back to original image on canvas failure with warning | `extension/src/privacy.stub.ts:85`, `ESSENTIAL_RUNNING_ITEMS.md §1` |
| 6 | Redaction Engine | 4px CSS Safety Margin | Applies 4px CSS padding scaled by DPR around detected face bounds to guarantee zero border bleed. | Raw bounding box, scale factor | Expanded bounding box $[rx, ry, rw, rh]$ | Clamped to canvas bounds $(0, 0, W, H)$ | `extension/src/privacy.stub.ts:118` |
| 7 | Lifecycle | Session Reuse & Resident Memory | Pre-warms and retains inference session across multiple cycles without reloading weights. | Startup signal, model asset path | Active `InferenceSession` / `FaceDetector` | Re-initializes on context lost | `tackling face detection.md §10`, `readme files/02_MEMBER_2_... §5.1` |
| 8 | Hardware Fallback | Dynamic GPU to CPU Fallback | Detects GPU delegate failure and re-initializes on CPU WASM provider. | GPU init exception | CPU inference session | Throws explicit `StageError` if both fail | `extension/src/vision/engine.ts:50-59`, `tackling face detection.md §22` |
| 9 | Multi-Face | Concurrent Face Tracking | Identifies and outputs multiple faces simultaneously in group photos or complex pages. | Static image with multiple faces | Array of `FaceBox` objects | Handles empty array gracefully if 0 faces | `tackling face detection.md §2`, `contracts/ts/vision.ts:23` |
| 10 | Security / DOM | Collision Check against Interactive UI | Disallows false positive face detections on buttons, canvas, or input fields. | `FaceBox`, DOM snapshot elements | Filtered face detection list | Drops face tag if $>40\%$ overlaps interactable button | `extension/src/privacy.stub.ts:538-551` |
| 11 | Memory Management | CaptureStore & TTL Eviction | Memory-only image bitmap storage with 15-second TTL and explicit release endpoint. | `capture_id`, `ImageBitmap` | Stored bitmap handle | Evicts stale buffers automatically | `readme files/02_MEMBER_2_... §5.1 (Task 3.6)` |
| 12 | Benchmarking | 100-Image Benchmark Harness | Executes sequential test loop, collects timing stats, measures RAM/VRAM deltas. | Test image set (100 images) | Formatted benchmark card with P50/P95/P99 | Flags memory leak if heap slope $> 0.05\text{ MB/iter}$ | `tackling face detection.md §20`, `ORIGINAL_REQUEST.md:41` |
| 13 | Diagnostics | 4-Class Failure Diagnosis | Categorizes perception errors into Model Fail (A), Box Wrong (B), Flaky (C), Too Slow (D). | Test execution telemetry | Failure category verdict & root cause checklist | Prompts specific hyperparameter/code remedies | `tackling face detection.md §3` |
| 14 | System Telemetry | Phase-Separated Latency Spans | Records microsecond-level timing spans for crop, preprocess, inference, postprocess, redaction. | Cycle ID, stage name | `timings_ms` in `VisionStats` | Silently ignores telemetry errors if sink down | `contracts/ts/vision.ts:46-60`, `extension/src/telemetry/span.ts` |
| 15 | Model Quantization | Multi-Format Quantization Matrix | Benchmarks and supports INT8, FP16, and FP32 model formats. | ONNX / TFLite quantized models | Performance & accuracy comparison table | Selects FP16/FP32 if INT8 accuracy drops excessively | `tackling face detection.md §6` |

---

## 7. Edge Cases & Observed / Expected Behavior

| # | Feature | Input Condition | Observed / Documented Behavior |
|---|---------|-----------------|--------------------------------|
| 1 | Face Redaction | Face touches or crosses image boundary (left, right, top, bottom edge). | Bounding box coordinates clamped to $[0, 0, W_{\text{canvas}}, H_{\text{canvas}}]$; blackout box drawn flush with image border without throwing coordinate index errors. |
| 2 | Detection Engine | Zero faces present in image (CAT-10 / landscape / form). | Returns valid result with `faces: []`; zero redactions performed; never treated as an exception or error. |
| 3 | Small Face | Small face avatar ($\le 80 \times 80$ px in $1920 \times 1080$ viewport). | May fail detection if resized directly to $320 \times 180$; requires perception resolution $\ge 640 \times 360$ or crop-based inspection. |
| 4 | Large Portrait | Large close-up face covering $> 60\%$ of viewport. | Single large bounding box accurately computed; does not trigger false multi-face splits. |
| 5 | Non-Standard DPR | High-DPI display with non-integer DPR (e.g. $\text{DPR} = 1.25, 1.5, 2.0$). | Scaling factors correctly multiply CSS pixels by DPR to target exact physical bitmap pixels; avoids offset redaction masks. |
| 6 | Occluded Face | Partially visible face (profile or mask, $30\%$ visible). | Detects face with reduced confidence; if score $\ge 0.50$, masks properly; otherwise suppressed cleanly. |
| 7 | False Positive Lookalike | Cartoon avatar, anime drawing, mannequin, emoji. | Evaluated against confidence threshold; non-photorealistic lookalikes should be rejected or logged in false-positive statistics. |
| 8 | WebGPU Missing | Host environment lacks WebGPU support (headless CI or unexposed GPU in VM). | Caught during adapter request or session creation; falls back cleanly to WASM SIMD / CPU provider without user interruption. |
| 9 | Rapid Screenshot Influx | User rapidly scrolls or navigates, generating 5 screenshots in 1 second. | Obsolete queued screenshots discarded; only the latest active screenshot processed to prevent queue death spirals. |
| 10 | Memory Pressure | 100 consecutive image inferences executed in long-running session. | All `ImageBitmap` handles and temporary canvas contexts destroyed; JS heap stabilizes without monotonically unbounded growth. |
| 11 | Corrupt Image Input | Truncated base64 data URL or invalid image header. | Preprocessor fails gracefully; emits structured `StageError` ('BAD_INPUT', 'vision') rather than unhandled rejection. |
| 12 | Collision with UI Button | Face appears as an icon inside an actionable submit button. | Privacy engine collision filter detects $>40\%$ IoU overlap with interactive button and avoids blanking out entire actionable button. |

---

## 8. Acceptance Criteria Inventory (All 16 Criteria)

| Criterion ID | Verbatim Acceptance Criterion | Verification Method & Target Metric | Verification Command / Artifact |
|---|---|---|---|
| **AC-01** | Static images are detected reliably. | Run deterministic test suite on CAT-01 (frontal face); 100% recall on high-contrast frontal faces. | Test suite execution against static test image fixture. |
| **AC-02** | Multiple faces work. | Run CAT-02 (multiple faces); detector returns $N$ separate bounding boxes matching all ground truth faces. | Test suite verification on multi-face fixture. |
| **AC-03** | Small faces are tested. | Run CAT-03 (small faces $\le 80\times 80$ px); measure detection recall across resolutions $320\text{--}640$ px. | Benchmark test across resolution ladder. |
| **AC-04** | Bounding boxes are correct. | Calculate Intersection over Union (IoU) against annotated ground truth; $\text{IoU} \ge 0.70$ on detected faces. | Automated IoU evaluation script. |
| **AC-05** | Screenshot coordinate mapping is correct. | Verify that transformed coordinates match original screenshot coordinates across DPR 1.0, 1.5, and 2.0. | Geometric unit test verifying inverse scaling equations. |
| **AC-06** | Redaction completely covers detected faces. | Inspect redacted image bitmap; verify zero original biometric pixels remain in masked regions with 4px padding. | Visual redaction pixel inspection test. |
| **AC-07** | No unnecessary model reload occurs. | Verify model load counter remains 1 across 100 repeated inference calls; session object reused. | Session lifecycle spy/counter unit test. |
| **AC-08** | CPU usage is measured. | Profile CPU utilization during 100-image benchmark; record average and peak CPU %. | Benchmark report telemetry output. |
| **AC-09** | GPU usage is measured. | Profile GPU utilization and memory via CDP or system tools; record GPU % and memory. | Benchmark report telemetry output. |
| **AC-10** | RAM usage is measured. | Measure JS Heap and process RAM before and after 100 runs; ensure peak RAM $< 150\text{ MB}$. | `performance.memory` telemetry logging. |
| **AC-11** | VRAM usage is measured. | Measure model VRAM allocation; ensure bounded footprint ($< 250\text{ MB}$). | Hardware benchmark card. |
| **AC-12** | GPU fallback works. | Explicitly disable GPU / simulate GPU init failure; verify pipeline catches error and switches to CPU. | Unit test with mocked GPU failure. |
| **AC-13** | CPU fallback works. | Run complete perception pipeline in CPU-only mode (WASM SIMD); verify 100% test pass. | Test run with `backend=wasm`. |
| **AC-14** | No memory leak occurs during repeated image processing. | Run 100 inferences; verify JS heap slope $< 0.05\text{ MB/iter}$ and no unreleased `ImageBitmap` handles. | 100-iteration memory regression test. |
| **AC-15** | 100-image benchmark completes successfully. | Execute 100 iterations on test set; generate complete statistics report (Avg, P50, P95, P99, Max). | `npm run benchmark:face` or benchmark runner script. |
| **AC-16** | Complete perception pipeline is benchmarked against SIH sub-500ms target, DOM perception remains functional, browser-agent workflow remains functional, and final report generated. | Measure end-to-end perception latency (P95 $< 500\text{ ms}$), verify DOM tests pass (`pnpm test`), run Playwright login E2E test, and generate root cause report. | `pnpm test`, `npx playwright test`, final diagnostic report. |

---

## 9. Requirements Traceability Matrix (RTM)

| Requirement ID | Acceptance Criteria | Primary Source Reference | Affected Codebase Components / Files | Verification Method | Priority / Risk |
|---|---|---|---|---|---|
| **REQ-R1.1** (Pipeline Audit) | AC-01, AC-07 | `ORIGINAL_REQUEST.md:12`, `tackling face detection.md §1` | `extension/src/background/orchestrator.ts`, `vision/engine.ts` | Static inspection & telemetry trace verification | High / Low |
| **REQ-R2.1** (Deterministic Suite) | AC-01, AC-02, AC-03 | `ORIGINAL_REQUEST.md:15`, `tackling face detection.md §2` | `tests/fixtures/faces/`, `tests/unit/face-detector.test.ts` | Vitest test suite executing 10 categories | Critical / Medium |
| **REQ-R2.2** (False Positive Control) | AC-01, AC-10 | `tackling face detection.md §19` | `tests/fixtures/faces/negatives/` | Zero-detection assertion on non-face images | High / Low |
| **REQ-R3.1** (Failure Classification) | AC-04, AC-16 | `ORIGINAL_REQUEST.md:18`, `tackling face detection.md §3` | `reports/face_detection_diagnosis.md` | Formal classification into A, B, C, D | High / Low |
| **REQ-R4.1** (Controlled Resolutions) | AC-04, AC-16 | `ORIGINAL_REQUEST.md:21`, `tackling face detection.md §4` | `extension/src/vision/engine.ts`, `vision/preprocess.ts` | Benchmark 320x180, 512x288, 640x360 | High / Medium |
| **REQ-R4.2** (Coordinate Mapping) | AC-04, AC-05 | `ORIGINAL_REQUEST.md:21`, `tackling face detection.md §17` | `extension/src/vision/geometry.ts`, `privacy.stub.ts` | Coordinate inversion unit tests with varying DPR | Critical / High |
| **REQ-R4.3** (Quantization Formats) | AC-16 | `ORIGINAL_REQUEST.md:21`, `tackling face detection.md §6` | `extension/public/models/`, `tools/quantize/` | Accuracy & speed comparison across INT8/FP16/FP32 | Medium / Medium |
| **REQ-R4.4** (Session Reuse) | AC-07 | `ORIGINAL_REQUEST.md:22`, `tackling face detection.md §10` | `extension/src/vision/engine.ts`, `vision/session.ts` | Counter assertion verifying 1 init call | Critical / Low |
| **REQ-R5.1** (Resource Utilization) | AC-08, AC-09, AC-10, AC-11 | `ORIGINAL_REQUEST.md:24`, `tackling face detection.md §7` | `benchmarks/face/`, `extension/src/telemetry/` | Resource profiler measuring CPU, GPU, RAM, VRAM | High / Medium |
| **REQ-R5.2** (Memory Copy Minimization) | AC-14 | `tackling face detection.md §11` | `extension/src/vision/engine.ts` | Heap snapshot audit & explicit buffer release | High / Medium |
| **REQ-R5.3** (Complete Redaction) | AC-06 | `ORIGINAL_REQUEST.md:25`, `tackling face detection.md §18` | `extension/src/privacy.stub.ts`, `privacy/engine.ts` | Pixel-level bitmap inspection of masked regions | Critical / High |
| **REQ-R5.4** (Hardware Fallbacks) | AC-12, AC-13 | `ORIGINAL_REQUEST.md:25`, `tackling face detection.md §8, §22` | `extension/src/vision/engine.ts`, `vision/backend.ts` | Mock GPU failure and verify CPU fallback execution | Critical / Medium |
| **REQ-R5.5** (DOM Non-Regression) | AC-15, AC-16 | `ORIGINAL_REQUEST.md:25`, `tackling face detection.md §23` | `tests/unit/router.test.ts`, `tests/unit/assemble.test.ts` | Run full existing unit suite (`pnpm test`) | Critical / Low |
| **REQ-R5.6** (Sub-500ms P95 Latency) | AC-15, AC-16 | `ORIGINAL_REQUEST.md:43`, `tackling face detection.md §13` | Entire perception pipeline | 100-image benchmark reporting P95 latency | Critical / High |
| **REQ-R5.7** (100-Image Benchmark & Leaks)| AC-14, AC-15 | `ORIGINAL_REQUEST.md:40-41`, `tackling face detection.md §20`| `benchmarks/run-face-benchmark.ts` | Automated 100-cycle test with heap slope check | High / Medium |
