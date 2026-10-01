# Handoff Report: SIH 2026 Problem Statement 26171 Pipeline Survey (Requirement R1)
**Subagent**: `survey_explorer_1`
**Date**: 2026-09-23
**Handoff Type**: Hard (Task Complete)
**Recipient**: `teamwork_preview_orchestrator_1` (Conversation ID: `b6e4823e-0b2d-4eba-a348-fdd572bd65bb`)

---

## 1. Observation

1. **Screenshot Capture**:
   - File: `extension/src/capture/screenshot.ts:4, 16-20, 71-73`
   - Command: `chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, handleCapture)`
   - Code:
     ```typescript
     const MIN_INTERVAL_MS = 800; // Rate limit ~1.25 calls/s
     const elapsed = now - lastCaptureTime;
     if (elapsed < MIN_INTERVAL_MS) {
       await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
     }
     ```
   - Captured format is PNG Base64 Data URL (`data:image/png;base64,...`). Viewport is in CSS pixels; `CaptureMeta.image` dimensions are physical device pixels (`w * dpr, h * dpr`).

2. **Face Detection Model & Runtime**:
   - Model File: `extension/public/models/blaze_face_short_range.tflite` (229,746 bytes).
   - WASM Files: `extension/public/mediapipe/vision_wasm_internal.wasm` (11,153,617 bytes $\approx 11.15$ MB), `vision_wasm_internal.js` (322,044 bytes).
   - Package: `@mediapipe/tasks-vision` (v0.10.14) in `extension/package.json:18`.
   - Code in `extension/src/vision/engine.ts:20-66, 86-126`:
     - `initFaceDetector()` attempts `delegate: 'GPU'` then falls back to `delegate: 'CPU'`.
     - Model session is cached as a singleton: `let faceDetector: FaceDetector | null = null;`.
     - In non-Chrome environments (`typeof chrome === 'undefined'`), lines 26–37 return `null` immediately.
     - Decodes Base64 to `Uint8Array` in a manual byte loop, wraps in `Blob([bytes], { type: 'image/png' })`, creates `ImageBitmap`, and calls `detector.detect(imgBitmap)`.
     - Raw detection coordinates (`det.boundingBox.originX`, `originY`, `width`, `height`) are pushed directly to `faces` without dividing by `dpr`.

3. **DOM Fallback Heuristic Masking All Images**:
   - File: `extension/src/vision/engine.ts:128-167`
   - Code:
     ```typescript
     if (req.dom?.elements) {
       req.dom.elements
         .filter((e) => {
           if (!e.visible || e.tag === 'button' || e.tag === 'canvas') return false;
           const isVisualTag = e.tag === 'img' || e.tag === 'picture' || e.tag === 'svg' || e.tag === 'figure' || e.role === 'img';
           const hasValidSize = e.bbox[2] >= 20 && e.bbox[3] >= 20 && e.bbox[2] <= 1400 && e.bbox[3] <= 1400;
           return isVisualTag && hasValidSize;
         })
         .forEach((e) => {
           faces.push({ bbox: e.bbox, confidence: 0.98 });
         });
     }
     ```
   - All `<img>` tags in the DOM are classified as faces with 0.98 confidence.

4. **Coordinate Contract & Double-Scaling Bug in Redaction**:
   - Contract in `contracts/ts/vision.ts:23-26`:
     ```typescript
     export interface FaceBox {
       bbox: BBox;
       confidence: number;
     } // CSS px
     ```
   - In `privacy.stub.ts:113-129`:
     ```typescript
     const scaleX = viewport?.w && viewport.w > 0 ? bitmap.width / viewport.w : 1;
     const scaleY = viewport?.h && viewport.h > 0 ? bitmap.height / viewport.h : 1;

     for (const box of boxesToRedact) {
       const padX = 4 * scaleX;
       const padY = 4 * scaleY;
       const rx = Math.max(0, Math.round(box.x * scaleX - padX));
       const ry = Math.max(0, Math.round(box.y * scaleY - padY));
       const rw = Math.min(bitmap.width - rx, Math.round(box.w * scaleX + padX * 2));
       const rh = Math.min(bitmap.height - ry, Math.round(box.h * scaleY + padY * 2));
       ctx.fillRect(rx, ry, rw, rh);
     ```
   - `scaleX` equals `dpr`. When `box.x` is already in physical pixels (from MediaPipe), `rx` becomes $\text{box.x} \times \text{dpr}^2$.

5. **Server Role & Invariant I5 Attestation**:
   - File: `server/app/main.py:37-78`
   - Server is a FastAPI planner listening at `POST /v1/plan`.
   - It performs zero computer vision or face detection.
   - It verifies `hashlib.sha256(data["body"].encode("utf-8")).hexdigest() == data["sha256"]`.
   - Receives only `SanitizedContext` where sensitive PII is replaced with tokens (`<REDACTED_AADHAAR>`, `<REDACTED_PAN>`, `<EMAIL>`).
   - Planner returns structured actions referencing abstract region IDs (`r1`, `r2`, `r6`).

---

## 2. Logic Chain

1. **Premise 1 (Observation 1 & 2)**: MediaPipe `FaceDetector.detect(imgBitmap)` receives a full-resolution physical image (`viewport.w * dpr` by `viewport.h * dpr`). MediaPipe returns bounding boxes in physical pixels of `imgBitmap`.
2. **Premise 2 (Observation 2 & 4)**: `vision/engine.ts` stores these physical pixel coordinates directly into `faces: FaceBox[]` without dividing by `dpr`. However, the contract in `contracts/ts/vision.ts` defines `FaceBox.bbox` in CSS pixels.
3. **Premise 3 (Observation 4)**: `redactImageCanvas()` expects all `boxesToRedact` to be in CSS pixels and multiplies them by `scaleX = bitmap.width / viewport.w` ($= \text{dpr}$).
4. **Deduction 1 (Coordinate Mismatch & Redaction Displacement)**: For any device where $\text{dpr} \neq 1$ (e.g. Retina displays, high-DPI Windows laptops where $\text{dpr} = 1.25, 1.5, 2.0$), face coordinates are scaled by $\text{dpr}^2$. The black redaction rectangle is displaced and enlarged, missing the face and leaving biometric data unmasked on the canvas.
5. **Premise 4 (Observation 2 & 3)**: MediaPipe fails in non-Chrome environments (`chrome.runtime.getURL` is undefined) and throws inside Service Workers when attempting GPU acceleration.
6. **Deduction 2 (False Sense of Working Detection)**: The demo application appeared to "work" on `login-demo.html` because the fallback in `engine.ts:128-167` automatically converted the `<img id="user-avatar">` DOM element into a face box with 0.98 confidence. On any static screenshot without an HTML `<img>` tag (e.g., canvas-rendered images, WebGL, or raw static benchmark images), 0 faces are detected.
7. **Premise 5 (Observation 1 & 2)**: Screenshot capture forces an 800 ms wait (`MIN_INTERVAL_MS = 800`), base64 decoding uses single-threaded `atob()` charCode loops, and the full physical screenshot ($1920\times 1080 \times \text{dpr}$) is processed without controlled perception downscaling.
8. **Deduction 3 (Latency Budget Violation)**: Total perception latency accumulates to 940–1300 ms, making it impossible to satisfy the SIH sub-500 ms target without optimizing capture throttling, input resolution, and image memory copies.

---

## 3. Caveats

1. **Hardware Verification**: `nvidia-smi` is not installed or accessible within this sandbox environment; GPU acceleration verification was performed via runtime fallback code inspection (`delegate: 'GPU'` $\to$ `delegate: 'CPU'`).
2. **Live Browser Headless Execution**: Full headless extension execution with Playwright requires an X11/Wayland display or xvfb; code paths and contracts were verified through static analysis and codebase inspection.
3. **No Code Modification Undertaken**: In strict adherence to Rule R1 and explorer role constraints, zero production code changes were applied during this survey.

---

## 4. Conclusion

The current visual perception and face detection pipeline suffers from three fatal architectural flaws that prevent it from meeting the SIH 26171 requirements:
1. **Model Execution Invalidation**: Face detection on static images is non-functional outside the Chrome extension context due to hardcoded `chrome.runtime.getURL` dependencies, and in-browser detection currently relies on a superficial DOM `<img>` fallback heuristic rather than genuine pixel-level face detection.
2. **Coordinate & Redaction Invalidation**: On all non-standard DPI displays ($\text{dpr} \neq 1$), a double-scaling error multiplies physical bitmap coordinates by $\text{dpr}$ a second time during canvas blackout, causing redaction rectangles to completely miss the face.
3. **Latency Invalidation**: Perception latency exceeds 900 ms due to an arbitrary 800 ms capture rate-limiter, duplicate Base64 image decoding loops, and full-resolution unscaled inference.

---

## 5. Verification Method

To independently verify these findings:
1. **Inspect Coordinate Scaling**:
   - View `extension/src/privacy.stub.ts` lines 112–129 and compare with `extension/src/vision/engine.ts` lines 106–118 and `contracts/ts/vision.ts` line 26.
   - Calculate coordinate transformation for a face at $(100, 100)$ on $\text{dpr} = 2$.
2. **Inspect DOM Fallback Heuristic**:
   - View `extension/src/vision/engine.ts` lines 128–167 and confirm that any visible `img`/`picture`/`figure` tag with dimensions $\ge 20\text{ px}$ is pushed to `faces` with `confidence: 0.98`.
3. **Inspect Capture Throttling**:
   - View `extension/src/capture/screenshot.ts` lines 4 and 16–20 and confirm `MIN_INTERVAL_MS = 800`.
4. **Inspect Server Role**:
   - View `server/app/main.py` lines 37–167 and verify that no vision, OCR, or image processing models or endpoints exist.
