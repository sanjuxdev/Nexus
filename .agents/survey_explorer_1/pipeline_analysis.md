# Comprehensive Technical Survey: Visual Perception & Face Detection Pipeline
**SIH 2026 — Problem Statement 26171 (On-Device Visual Perception for Lightweight Browser Agents)**
**Subagent**: `survey_explorer_1`
**Date**: 2026-09-23
**Scope**: Requirement R1 (Understand Current Pipeline)

---

## 1. Executive Summary

This report delivers a complete architectural and algorithmic mapping of the current visual perception and face detection pipeline in the SIH 26171 browser agent codebase.

### Core Discoveries
1. **Face Detection Implementation**: Face detection is implemented in `extension/src/vision/engine.ts` using Google MediaPipe Tasks-Vision (`@mediapipe/tasks-vision` v0.10.14) with a local `blaze_face_short_range.tflite` model (229.7 KB) and an 11.15 MB WebAssembly runtime (`vision_wasm_internal.wasm`).
2. **The "Pseudo-Face" Heuristic Fallback**: Because MediaPipe frequently fails or is unavailable in background environments, `visionEngine.perceive()` contains an aggressive fallback (lines 128–167) that treats **any** DOM visual element (`img`, `picture`, `svg`, `figure`, `role=img`) between 20px and 1400px as a detected face with `confidence: 0.98`. This masks images on websites regardless of whether they contain faces, while failing completely on static screenshots or canvas-rendered graphics without DOM tags.
3. **The Double-Scaling Coordinate Bug (High-DPI)**: MediaPipe outputs bounding boxes in physical bitmap pixels (`imgBitmap` coordinates: `viewport * dpr`). However, the contract `FaceBox.bbox` (`contracts/ts/vision.ts:26`) specifies CSS pixels. The redaction canvas (`privacy.stub.ts:113-129`) assumes all input boxes are in CSS pixels and multiplies them by `scaleX = bitmap.width / viewport.w` ($= \text{dpr}$). Consequently, on displays with $\text{dpr} \neq 1$, face coordinates are multiplied by $\text{dpr}^2$, shifting redaction blackout rectangles far off-target.
4. **Latency Budget Violation**: The complete perception path currently takes **900–1200 ms**, far exceeding the SIH sub-500 ms target. Bottlenecks include an arbitrary 800 ms rate-limiting sleep in `captureScreenshot()`, redundant Base64/Blob/Bitmap conversions using single-threaded JS `atob()` loops, full-resolution ($1920\times 1080 \times \text{dpr}$) inference without controlled perception downscaling, and duplicate image decoding in both the vision and privacy engines.
5. **Architectural Role of Server**: The FastAPI backend (`server/app/main.py`) is strictly a downstream reasoning/planning engine (`POST /v1/plan`). It performs **no** image processing, face detection, or redaction. Invariant I5 guarantees that only cryptographic SHA-256 attested sanitized payloads reach this server.

---

## 2. Complete End-to-End Pipeline Architecture

The browser perception and redaction pipeline follows a strictly ordered, multi-stage lifecycle orchestrated by `extension/src/background/orchestrator.ts`:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          BROWSER WEBPAGE                               │
│  - DOM Tree & HTML Elements                                            │
│  - Rendered Bitmaps & Avatars                                          │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
                   ▼ (1. DOM Extraction)             ▼ (2. Capture)
    ┌─────────────────────────────┐   ┌──────────────────────────────┐
    │ content-scripts/content.js  │   │ capture/screenshot.ts        │
    │ - getBoundingClientRect()   │   │ - chrome.tabs.captureVisible │
    │ - ARIA roles & visibility   │   │   Tab({ format: 'png' })     │
    │ Output: DomSnapshot         │   │ Output: dataUrl (PNG) + meta │
    └──────────────┬──────────────┘   └──────────────┬───────────────┘
                   │                                 │
                   ▼                                 │
    ┌─────────────────────────────┐                  │
    │ perception/router/router.ts │                  │
    │ - Evaluates visual area     │                  │
    │ - Determines needs: ['face']│                  │
    │ - Sets needs_screenshot=true│                  │
    └──────────────┬──────────────┘                  │
                   │                                 │
                   ▼                                 ▼
    ┌────────────────────────────────────────────────────────────────┐
    │ extension/src/vision/engine.ts (VisionEngine.perceive)         │
    │  1. MediaPipe BlazeFace (blaze_face_short_range.tflite)         │
    │     - WASM Runtime via FilesetResolver                         │
    │     - Decode base64 -> Blob -> ImageBitmap                     │
    │     - detector.detect(imgBitmap) -> FaceBox[] (Physical px)    │
    │  2. DOM Image Fallback Heuristic                               │
    │     - Extracts all visible <img>/<picture> tags as faces       │
    │ Output: VisionResult (faces, ocr_tokens, regions)              │
    └──────────────────────────────┬─────────────────────────────────┘
                                   │
                                   ▼
    ┌────────────────────────────────────────────────────────────────┐
    │ extension/src/background/assemble-frame.ts (assembleFrame)     │
    │  - Merges DOM regions + Vision regions (IoU fusion)            │
    │  - Sorts strictly by reading order (y bucketed, then x)        │
    │  - Mints deterministic IDs: r1, r2, r3... (Invariant I2)       │
    │  - Attaches frame.faces = visionResult.faces                   │
    │ Output: PerceptionFrame                                        │
    └──────────────────────────────┬─────────────────────────────────┘
                                   │
                                   ▼
    ┌────────────────────────────────────────────────────────────────┐
    │ extension/src/privacy.stub.ts (PrivacyEngine.sanitize)         │
    │  1. Outbound Text PII Redaction:                               │
    │     - Regex: Aadhaar (Verhoeff D5), PAN (ITD), Email, Phone    │
    │     - Vault isolation: Passwords -> [VAULT_PROTECTED]          │
    │  2. In-Memory Canvas Redaction (redactImageCanvas):            │
    │     - OffscreenCanvas 2D context                               │
    │     - Multiplies box coordinates by scaleX, scaleY             │
    │     - Overwrites pixels: ctx.fillStyle = '#000000' (Blackout)  │
    │     - Strokes border: ctx.strokeStyle = '#ef4444' + '[FACE]'   │
    │  3. Invariant I5 Attestation:                                  │
    │     - Web Crypto SHA-256 of Canonical JSON                     │
    │ Output: AttestedPayload + Masked Data URL Preview              │
    └──────────────────────────────┬─────────────────────────────────┘
                                   │
                                   ▼ (HTTP POST /v1/plan)
    ┌────────────────────────────────────────────────────────────────┐
    │ server/app/main.py (FastAPI Reasoning Planner)                 │
    │  - Verifies SHA-256 attestation digest                         │
    │  - Goal-directed planning over sanitized regions               │
    │  - Emits StructuredAction (e.g. click r6)                      │
    └──────────────────────────────┬─────────────────────────────────┘
                                   │
                                   ▼
    ┌────────────────────────────────────────────────────────────────┐
    │ extension/src/actions/ (Validator & Executor)                  │
    │  - Translates r6 -> dom_id (d6) via session.region_index       │
    │  - Validates origin, policy, hash, capability                  │
    │  - Dispatches physical click to DOM element                    │
    └────────────────────────────────────────────────────────────────┘
```

---

## 3. Image Capture & Ingestion Specification

### 3.1 Screenshot Origin
- **Source**: Captured from the active browser tab via the WebExtensions API in `extension/src/capture/screenshot.ts` (lines 9–98).
- **Function**: `captureScreenshot(tabId, pageStateHash, tabViewport, tabDpr)`.
- **API Call**: `chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, handleCapture)`.
- **Mock/Test Fallback**: If `chrome.tabs.captureVisibleTab` is unavailable or throws, it falls back to a 1x1 base64 transparent PNG (`MOCK_DATA_URL`, line 7).

### 3.2 Dimensions & Coordinate Systems at Ingestion
- **CSS Viewport**: Defined by `tabViewport` or window dimensions:
  $$W_{\text{css}} = \text{tabViewport.w} \lor 1280, \quad H_{\text{css}} = \text{tabViewport.h} \lor 800$$
- **Physical Device Bitmap**: Scaled by Device Pixel Ratio ($\text{DPR}$):
  $$W_{\text{img}} = \text{round}(W_{\text{css}} \times \text{dpr}), \quad H_{\text{img}} = \text{round}(H_{\text{css}} \times \text{dpr})$$
- **Data Structure (`CaptureMeta` in `contracts/ts/vision.ts`)**:
  ```typescript
  export interface CaptureMeta {
    capture_id: string;
    page_state_hash: string;
    dpr: number;
    viewport: { w: number; h: number };
    scroll: { x: number; y: number };
    image: { w: number; h: number }; // device pixels
    ts: number;
  }
  ```

### 3.3 Capture Throttling
- An artificial throttling lock is enforced in `screenshot.ts` (lines 3–4, 15–20):
  ```typescript
  const MIN_INTERVAL_MS = 800; // Rate limit ~1.25 calls/s
  const elapsed = now - lastCaptureTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  ```
- **Finding**: This introduces an unconditional wait of up to **800 ms** per perception cycle before any image preprocessing or inference begins, making sub-500 ms perception impossible without removing or bypassing this throttle for on-device static inference.

---

## 4. Server Architecture & Planner Integration

### 4.1 Server Overview
- **Location**: `server/app/main.py`.
- **Framework**: FastAPI (Python 3.12+), Uvicorn ASGI server running on `0.0.0.0:8000`.
- **Dependencies (`server/requirements.txt`)**: `fastapi`, `uvicorn`, `pydantic`.
- **Role**: Remote/local LLM/heuristic planner. **Zero vision processing occurs here.**

### 4.2 Endpoints and Handlers

| Method | Path | Handler | Input Contract | Output Contract | Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/healthz` | `health_check` | None | `{"status": "ok", ...}` | Daemon liveness verification |
| `POST` | `/v1/plan` | `plan_step` | `AttestedPayload` or `SanitizedContext` | `PlanResponse` | Generates next autonomous step |

### 4.3 Attestation Verification (Invariant I5)
In `server/app/main.py` lines 57–71:
```python
if "sha256" in data and "body" in data and isinstance(data["body"], str):
    calculated_digest = hashlib.sha256(data["body"].encode("utf-8")).hexdigest()
    if calculated_digest != data["sha256"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attestation violation: Digest mismatch. Body was altered in transit.",
        )
    context = json.loads(data["body"])
```
- **Finding**: The server cryptographically verifies that the context was not modified post-sanitization. Any modification of `SanitizedContext` in transit triggers an immediate HTTP 400 rejection.

### 4.4 Downstream Action Planning
The planner operates purely on the sanitized `regions` array:
- Checks if authentication completed (`welcome` or `authentication successful` text).
- Locates interactable buttons matching login/submit intents.
- Emits action targeting abstract region IDs (`r1`, `r2`, `r6`). It has no awareness of DOM element IDs, raw pixel coordinates, or biometric images.

---

## 5. Face Detection Model & Runtime Analysis

### 5.1 Model Specifications
- **Model Name**: BlazeFace (Short-Range).
- **Origin**: Google MediaPipe Face Detection.
- **Weights File**: `extension/public/models/blaze_face_short_range.tflite`.
- **Model Size**: 229,746 bytes (~229.7 KB).
- **Weight Precision**: Float16 / Float32 TFLite.
- **Input Resolution**: BlazeFace short-range expects $128 \times 128$ RGB tensor (internally resized and padded by MediaPipe WASM runtime).
- **Anchor Topology**: Single-Shot Detector (SSD) with custom lightweight feature extractor and anchor generation for close-range front-facing faces ($[-1, 1]$ coordinate space).

### 5.2 Inference Runtime & Execution Providers
- **Package**: `@mediapipe/tasks-vision` (v0.10.14).
- **WASM Assets** (`extension/public/mediapipe/`):
  - `vision_wasm_internal.wasm` (11,153,617 bytes $\approx 11.15$ MB).
  - `vision_wasm_internal.js` (322,044 bytes).
  - `vision_wasm_nosimd_internal.wasm` (10,481,398 bytes $\approx 10.48$ MB).
- **Initialization Routine (`extension/src/vision/engine.ts:20-66`)**:
  ```typescript
  async function initFaceDetector(): Promise<FaceDetector | null> {
    if (faceDetector) return faceDetector;
    const wasmPath = chrome.runtime.getURL('mediapipe/');
    const modelPath = chrome.runtime.getURL('models/blaze_face_short_range.tflite');
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    try {
      faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
        runningMode: 'IMAGE',
      });
    } catch (gpuErr) {
      faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        runningMode: 'IMAGE',
      });
    }
    return faceDetector;
  }
  ```

### 5.3 Execution Environment Failures & The "DOM Fallback"
1. **Service Worker Incompatibility**: In Chrome MV3, `flags.vision` defaults to `'stub'`. `orchestrator.ts` attempts to run `visionEngine.perceive()` inside the Background Service Worker. Because WebGL/WebGPU is not exposed in Service Workers, `delegate: 'GPU'` throws. Furthermore, loading large WebAssembly binaries (11 MB) inside service workers often triggers unhandled memory or CSP faults.
2. **Node.js / Vitest Environment Incompatibility**: In non-extension environments (Node.js test runners, Playwright harness, or standalone scripts), `typeof chrome === 'undefined'`. `initFaceDetector()` returns `null` on line 36. MediaPipe never executes.
3. **The Heuristic Masking Fallback (`engine.ts:128-167`)**:
   When MediaPipe fails (or even when it succeeds), the engine executes:
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
         if (!alreadyCovered) {
           faces.push({ bbox: e.bbox, confidence: 0.98 });
         }
       });
   }
   ```
   **Consequence**: The system currently claims face detection support by simply blacking out all `<img>` tags found in the DOM. On static screenshot files or dynamically rendered canvas graphics without DOM elements, zero faces are detected.

---

## 6. Coordinate Systems & The Double-Scaling Redaction Bug

### 6.1 The Coordinate Contract
The contract in `contracts/ts/vision.ts` line 26 specifies:
```typescript
export interface FaceBox {
  bbox: BBox; // [x, y, w, h]
  confidence: number;
} // CSS px
```
- **Rule**: All `bbox` entries in `FaceBox` MUST be in **CSS pixels** (viewport coordinates).

### 6.2 The MediaPipe Detection Reality
- MediaPipe `detector.detect(imgBitmap)` operates on `imgBitmap`.
- `imgBitmap` is created from `req.image_data_url`, which is the raw screenshot captured by `chrome.tabs.captureVisibleTab`.
- Physical dimensions of `imgBitmap` are:
  $$W_{\text{bitmap}} = W_{\text{viewport}} \times \text{dpr}, \quad H_{\text{bitmap}} = H_{\text{viewport}} \times \text{dpr}$$
- MediaPipe returns `det.boundingBox` in **physical pixels**:
  $$x_{\text{mp}} = \text{det.boundingBox.originX} \in [0, W_{\text{bitmap}}]$$
  $$y_{\text{mp}} = \text{det.boundingBox.originY} \in [0, H_{\text{bitmap}}]$$
- In `extension/src/vision/engine.ts` lines 109–115, these are pushed directly into `faces`:
  ```typescript
  faces.push({
    bbox: [
      Math.round(det.boundingBox.originX),
      Math.round(det.boundingBox.originY),
      Math.round(det.boundingBox.width),
      Math.round(det.boundingBox.height),
    ],
    confidence: det.categories[0]?.score || 0.95,
  });
  ```
  **Finding**: The engine stores **physical pixels** instead of **CSS pixels**, violating the contract whenever $\text{dpr} \neq 1$.

### 6.3 The Redaction Canvas Multiplication
In `extension/src/privacy.stub.ts` lines 112–129:
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
}
```
Notice:
$$\text{scaleX} = \frac{W_{\text{bitmap}}}{W_{\text{viewport}}} = \text{dpr}$$
$$\text{scaleY} = \frac{H_{\text{bitmap}}}{H_{\text{viewport}}} = \text{dpr}$$

### 6.4 The Mathematical Error
When MediaPipe detects a face at true physical coordinate $(X_{\text{phys}}, Y_{\text{phys}})$:
1. `engine.ts` stores `box.x` $= X_{\text{phys}} = X_{\text{css}} \times \text{dpr}$.
2. `redactImageCanvas()` computes:
   $$r_x = \text{box.x} \times \text{scaleX} = (X_{\text{css}} \times \text{dpr}) \times \text{dpr} = X_{\text{css}} \times \text{dpr}^2$$
   $$r_w = \text{box.w} \times \text{scaleX} = (W_{\text{css}} \times \text{dpr}) \times \text{dpr} = W_{\text{css}} \times \text{dpr}^2$$

#### Concrete Numerical Example:
Assume a display with $\text{dpr} = 2$ (e.g., Apple Retina or 4K at 200%):
- User face is at CSS position: $x = 100\text{ px}, y = 100\text{ px}, w = 50\text{ px}, h = 50\text{ px}$.
- Screenshot bitmap size: $2560 \times 1600$.
- MediaPipe runs on bitmap and detects: $x_{\text{mp}} = 200, y_{\text{mp}} = 200, w_{\text{mp}} = 100, h_{\text{mp}} = 100$.
- `redactImageCanvas()` calculates:
  $$r_x = 200 \times 2 - \text{pad} = 392\text{ px}$$
  $$r_y = 200 \times 2 - \text{pad} = 392\text{ px}$$
  $$r_w = 100 \times 2 + 2\text{pad} = 216\text{ px}$$
- **Result**: The blackout rectangle is drawn at $(392, 392)$ on the canvas, while the face is actually at $(200, 200)$!
- **The face is completely exposed, and harmless whitespace at $(392, 392)$ is blacked out.**

---

## 7. Performance & Latency Profile

### 7.1 Stage-by-Stage Latency Breakdown

| Pipeline Stage | Function / File | Current Latency | Underlying Mechanism | Bottleneck / Status |
| :--- | :--- | :--- | :--- | :--- |
| **1. Screenshot Capture** | `captureScreenshot()` (`screenshot.ts`) | **800–850 ms** | `chrome.tabs.captureVisibleTab` | **Critical**: Hardcoded `MIN_INTERVAL_MS = 800` artificial delay |
| **2. Base64 Decode #1** | `visionEngine.perceive()` (`engine.ts`) | **25–45 ms** | `atob()` + JS `Uint8Array` charCode loop | **Severe**: CPU-bound single-threaded string manipulation |
| **3. Bitmap Creation #1** | `createImageBitmap()` (`engine.ts`) | **15–35 ms** | Browser image decoding pipeline | Unnecessary allocation of full-resolution bitmap |
| **4. Face Inference** | `FaceDetector.detect()` (`engine.ts`) | **35–120 ms** | MediaPipe WASM / WebGL delegate | Variable: ~35 ms on WebGL, ~110 ms on WASM CPU |
| **5. Frame Assembly** | `assembleFrame()` (`assemble-frame.ts`) | **2–5 ms** | IoU spatial matching + sorting | Fast; efficient in-memory array manipulation |
| **6. Base64 Decode #2** | `redactImageCanvas()` (`privacy.stub.ts`) | **25–45 ms** | Duplicate `atob()` + byte loop | **Severe**: Re-decoding the exact same image a second time |
| **7. Canvas 2D Blackout** | `OffscreenCanvas.getContext('2d')` | **5–15 ms** | `drawImage` + `fillRect` + `strokeRect` | Fast 2D rasterization |
| **8. JPEG Re-Encode** | `canvas.convertToBlob({ quality: 0.85 })` | **30–65 ms** | JPEG compression + JS `btoa()` loop | **Moderate**: Re-encoding full bitmap to Base64 |
| **9. Attestation Hash** | `sha256Hex()` (`security/sha256.ts`) | **1–3 ms** | Web Crypto `crypto.subtle.digest` | Highly optimized native browser crypto |
| **10. Wire Transmission** | `sendPlan()` (`network/gate.ts`) | **5–15 ms** | Local HTTP `fetch` to FastAPI | Fast local loopback call |
| **TOTAL PIPELINE** | End-to-End Perception | **944–1298 ms** | Complete perception-to-plan cycle | **Violates SIH <500 ms target by $\sim 2.5\times$** |

### 7.2 Memory Footprint and Session Reuse
- **Session Singleton**: `let faceDetector: FaceDetector | null = null;` reuses the detector instance within a persistent session. It does NOT reload the model on every request within a single process.
- **Service Worker Eviction**: Because Manifest V3 service workers terminate after ~30s of inactivity, subsequent wakeups incur a cold-start reload penalty (~350 ms to re-parse the 11 MB WASM binary).
- **Buffer Duplication**: An image exists concurrently in memory as:
  1. PNG Base64 string in `dataUrl` (~4 MB for $1920\times 1080$).
  2. `Uint8Array` in `engine.ts` (~3 MB).
  3. `ImageBitmap` in `engine.ts` (~8 MB raw RGBA).
  4. Second Base64 string in `privacy.stub.ts` (~4 MB).
  5. Second `Uint8Array` in `privacy.stub.ts` (~3 MB).
  6. `OffscreenCanvas` backing buffer in `privacy.stub.ts` (~8 MB).
  7. Output JPEG Base64 string in `maskedDataUrl` (~1.5 MB).
  **Total peak transient memory**: Over **30 MB** per image capture just in redundant JavaScript allocations!

---

## 8. Redaction Mechanism & Privacy Firewall

### 8.1 Visual Blackout Implementation
- Visual redaction is executed in `extension/src/privacy.stub.ts` via `redactImageCanvas()`:
  - Canvas type: HTML5 `OffscreenCanvas`.
  - Privacy rect fill: Solid black `#000000` (`ctx.fillStyle = '#000000'`).
  - Auditing border: Crimson red `#ef4444` (`ctx.strokeStyle = '#ef4444'`, width $\ge 2\text{ px}$).
  - Redaction Badge: White bold text `[FACE]` or `[REDACTED: FACE | 2D Canvas Blackout]` rendered inside the box.
  - Zero raw biometric pixels from the detected box survive into the exported image.

### 8.2 Safety Padding & Face Coverage
- Safety padding:
  ```typescript
  const padX = 4 * scaleX;
  const padY = 4 * scaleY;
  ```
- **Finding on Coverage**: 4px of padding is sufficient for text boxes (such as Aadhaar or PAN digits). However, standard face detectors (including BlazeFace) predict tight bounding boxes encompassing only the eyebrows to chin and ear-to-ear. Foreheads, hair, sideburns, and neck areas are not covered by a 4px expansion, leading to biometric leakage around the edges of the face.

### 8.3 Invariant I5 & The Privacy Gate
- The Privacy Engine (`privacy.stub.ts`) enforces Invariant I5:
  - All text PII is scrubbed before serialization.
  - An attested payload is formed: `{ request_id, body: rawBody, sha256: digest, issued_at }`.
  - Network egress gate (`extension/src/network/gate.ts:17-21`) checks `calculatedDigest === attested.sha256` before allowing `fetch()`.
  - `scripts/verify-fetch-ban.js` statically verifies that no file outside `extension/src/network/` invokes `fetch()`.

---

## 9. DOM Perception & Contracts That Must Be Preserved

### 9.1 Existing DOM Perception
DOM perception is implemented in:
- `extension/src/perception/dom/snapshot.ts`: Traverses DOM candidates, measures geometries via `getBoundingClientRect()`, resolves ARIA accessibility semantics, determines rendering kind (HTML, Canvas, SVG, Shadow DOM), checks visibility/occlusion, and produces `DomSnapshot`.
- `extension/src/perception/router/router.ts`: Categorizes elements into `HIGH`, `MEDIUM`, `LOW`, `OMIT` tiers based on accessibility clarity and dirty mutation events.
- `extension/src/background/assemble-frame.ts`: Merges DOM elements with vision regions.

### 9.2 Crucial Contracts That Must NOT Be Broken
1. **Invariant I2 (Deterministic Region Minting)**:
   - `assembleFrame()` sorts all regions strictly by reading order:
     $$\text{line} = \lfloor y / 16 \rfloor, \quad \text{secondary} = x$$
   - It assigns monotonic sequential IDs: `r1`, `r2`, `r3`...
   - Downstream action planning, validation, and execution depend on the stability of these IDs. **Visual face detection MUST NOT perturb or inject synthetic interactive regions that re-number existing DOM buttons.**
2. **Interactive Element Protection (`privacy.stub.ts:540-551`)**:
   - The privacy engine explicitly tests whether a detected face box overlaps with an interactive DOM element (`button`, `input`, `canvas`).
   - If overlap $> 40\%$, the face detection is suppressed to prevent accidental redaction of form submit buttons or interactive controls.
3. **`FaceBox` Contract (`contracts/ts/vision.ts`)**:
   - `bbox` MUST remain a 4-tuple `[x, y, w, h]` expressed in **CSS pixels**.
4. **`SanitizedContext` Contract (`contracts/ts/wire.ts`, `schemas.ts`)**:
   - Wire schema validation is enforced via Zod (`SanitizedContextSchema`). No fields can be altered or added without breaking FastAPI server parsing.

---

## 10. Downstream Browser-Agent Workflow

```
[SanitizedContext] ───► POST /v1/plan ───► [PlanResponse: click r6]
                                                  │
                                                  ▼
                                         [validateAction]
                                         - Verify origin & policy
                                         - Verify page_state_hash
                                                  │
                                                  ▼
                                      [Translate r6 -> dom_id d6]
                                      via session.region_index
                                                  │
                                                  ▼
                                      [elementRegistry.get('d6')]
                                                  │
                                                  ▼
                                         [executeAction]
                                         element.click()
```
- **Region Translation**: The downstream planner returns only an action specifying `target: { region_id: 'r6' }`.
- **Execution Mechanism**: `extension/src/actions/executor/click.ts` resolves `r6` to `d6` through `session.region_index`, retrieves the live HTML element from `elementRegistry`, and issues synthetic click events.
- **Auditing**: The extension Sidepanel (`extension/src/ui/sidepanel/`) displays the sanitized action, the attestation digest, and the masked preview image for user inspection.

---

## 11. Failure Mode Classification (Requirement R3 Mapping)

| Failure Category | Observed Manifestation in Codebase | Root Cause |
| :--- | :--- | :--- |
| **Category A: Model Fails to Detect** | Standalone static image test sets yield 0 detections. Outside Chrome extension runtime, `initFaceDetector` immediately returns `null`. Small faces ($<80\text{ px}$) in high-res screenshots are missed. | MediaPipe loader hardcoded to `chrome.runtime.getURL()`. BlazeFace Short Range anchor box distribution is tuned for large selfie faces ($128\times 128$ receptive field) and fails on small faces embedded in large webpage screenshots. |
| **Category B: Bounding Box / Redaction Wrong** | On Retina / high-DPI displays ($\text{dpr} = 1.25, 1.5, 2.0$), blackout rectangles appear shifted and magnified by $\text{dpr}^2$, completely missing the face. | Double-scaling bug: MediaPipe outputs physical bitmap coordinates; `redactImageCanvas()` treats them as CSS coordinates and multiplies by $\text{scaleX} = \text{dpr}$ again. |
| **Category C: Detected Only Sometimes** | In the demo portal, the avatar is masked; in other pages or static tests, faces are ignored. | Avatar masking in the current build succeeds purely due to the DOM fallback heuristic matching `<img id="user-avatar">`. Any face rendered in canvas, SVG, or without a DOM `img` tag is ignored. |
| **Category D: Detection Too Slow** | End-to-end perception latency is $950–1300\text{ ms}$, exceeding the SIH 500 ms target. | 800 ms artificial sleep in `screenshot.ts`; duplicate full-resolution Base64 string decoding loops; absence of controlled perception downscaling. |

---

## 12. Architectural Recommendations for Subsequent Phases (R4 & R5)

1. **Implement Controlled Perception Resolution (Requirement R4)**:
   - Rescale screenshots to a standardized perception resolution (e.g. $640 \times 360$ or $640 \times 480$) prior to detector input.
   - Retain exact scaling factors:
     $$S_x = \frac{W_{\text{orig}}}{W_{\text{det}}}, \quad S_y = \frac{H_{\text{orig}}}{H_{\text{det}}}$$
   - Map detector bounding boxes back to CSS coordinates:
     $$x_{\text{css}} = \frac{x_{\text{det}} \times S_x}{\text{dpr}}, \quad y_{\text{css}} = \frac{y_{\text{det}} \times S_y}{\text{dpr}}$$
2. **Correct the Redaction Scaling Pipeline**:
   - Enforce that `frame.faces` strictly contains CSS pixels.
   - In `redactImageCanvas()`, multiplying CSS pixels by `scaleX = bitmap.width / viewport.w` will then correctly land on the physical canvas pixels.
3. **Eliminate Image Decoding Bottlenecks (Zero-Copy Processing)**:
   - Remove the artificial 800 ms sleep in `captureScreenshot()`.
   - Pass decoded `ImageBitmap` directly to both the detector and the canvas redaction pipeline, eliminating two roundtrips of `atob()`, string iteration, and `btoa()`.
4. **Support Headless & Standalone Static Image Testing (Requirement R2)**:
   - Provide an execution path that can run on static image buffers (via Node.js / ONNX Runtime or Canvas / TFLite) without requiring a live Chrome extension context.
