# SIH 2026 Problem Statement 26171: Testing Infrastructure, Hardware Environment & Baseline Benchmark Survey

**Subagent**: `survey_explorer_2` (Test & Environment Explorer)  
**Date**: 2026-09-23  
**Working Directory**: `/home/agent-s/Documents/GitHub/.agents/survey_explorer_2`  
**Report Target**: `/home/agent-s/Documents/GitHub/.agents/survey_explorer_2/test_env_report.md`  
**Authoritative Request**: `/home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md` & `tackling face detection.md`

---

## Executive Summary

1. **Testing Infrastructure Reality**: The project uses **Vitest v3.0.7** for unit tests (configured for `node` environment) and **Playwright v1.63.0** for browser E2E tests against a mock portal (`test-site/shared/login-demo.html`). However, **0 test cases, 0 test fixtures, and 0 test images currently exist for face detection**. All existing tests in `tests/unit/` (`assemble.test.ts`, `privacy-stub.test.ts`, `router.test.ts`, `phase1-e2e-flow.test.ts`) test text PII (Aadhaar, PAN, Email) and DOM routing, with `faces: []` hardcoded in test fixtures.
2. **Current "Face Detection" Mechanism**: Face detection has been largely bypassed by a DOM heuristic in `extension/src/vision/engine.ts:128-167` that intercepts all HTML `<img>`, `<picture>`, and `<svg>` elements and blindly reclassifies them as faces with 0.98 confidence. In `login-demo.html`, an external Unsplash avatar image was used to trigger this DOM fallback. Real visual neural face detection via MediaPipe (`blaze_face_short_range.tflite`) is aborted in test environments because `typeof chrome === 'undefined'`, and in extension contexts is vulnerable to coordinate scaling mismatches and runtime delegate crashes.
3. **Hardware Environment**: The host machine possesses an **Intel Core i5-12450H (12 logical cores / 8 physical cores)** with **15.5 GB RAM (14.78 GiB)** running **Ubuntu 24.04 Linux (kernel 7.0.0-31-generic x86_64)**. GPU device nodes `/dev/nvidiactl` and `/dev/dri/renderD128` exist, corresponding to an NVIDIA GeForce RTX 3050 Laptop GPU (4 GB VRAM). However, tests run under snap-isolated CLI confinement where `/home/agent-s/Documents/GitHub` is mounted `noexec` (requiring explicit interpreter execution `node ...` / `python3 ...`).
4. **10 Failure Categories Status**: All **10 deterministic failure reproduction categories** mandated by R2 (single face, multiple faces, small, large, partial, side-profile, webpage screenshot, image element, dynamic render, no-face) are **completely missing** from the test suite and repository image assets.
5. **Critical Coordinate Bug Identified**: In `contracts/ts/vision.ts:26`, `FaceBox.bbox` is contractually required to be in **CSS pixels**. However, MediaPipe returns physical bitmap coordinates (`det.boundingBox`). In `extension/src/vision/engine.ts`, physical coordinates were passed directly into `faces`, and `privacy.stub.ts:redactImageCanvas()` subsequently multiplied them by `scaleX = bitmap.width / viewport.w` ($= \text{dpr}$) again. On high-DPI displays ($\text{dpr} \ge 1.25$), face redactions are displaced and scaled by $\text{dpr}^2$, completely missing the face (Category B failure).

---

## 1. Testing Infrastructure Assessment

### 1.1 Test Runners and Configuration

| Runner | Version | Configuration File | Target Scope | Environment | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Vitest** | `^3.0.7` | `/home/agent-s/Documents/GitHub/vitest.config.ts` | `tests/unit/**/*.test.ts` | `node` | Active (Runs via `pnpm test`) |
| **Playwright** | `^1.63.0` | `/home/agent-s/Documents/GitHub/playwright.config.ts` | `tests/e2e/**/*.spec.ts` | `chromium` (Desktop Chrome) | Active (Runs via `pnpm e2e`) |
| **Python Test Runner** | N/A | None (`server/requirements.txt` has only `fastapi`, `uvicorn`, `pydantic`) | `server/app/main.py` | Python 3.12 (`server/.venv`) | Spawned via Vitest `child_process.spawn` |

#### Vitest Details (`vitest.config.ts`)
- **Environment**: `'node'`. This is critical: browser APIs like `window`, `document`, `OffscreenCanvas`, `createImageBitmap`, `chrome.runtime`, and WebGPU are **not present** by default in Vitest unit tests.
- **Path Aliases**:
  - `@contracts/*` $\to$ `contracts/ts/*`
  - `@contracts` $\to$ `contracts/ts/index.ts`
  - `@/*` $\to$ `extension/src/*`
- **Exclusions**: `node_modules/**`, `dist/**`, `tests/e2e/**`.

#### Playwright Details (`playwright.config.ts`)
- **Browser**: Chromium (`headless: true`).
- **Web Server Hook**: Automatically launches `node test-site/server.js` on `http://localhost:5173/login-demo.html` with a 10s startup timeout and `reuseExistingServer: true`.
- **Extension Harness** (`tests/e2e/harness.ts`):
  - Prepares extension launch flags: `--disable-extensions-except=extension/.output/chrome-mv3`, `--load-extension=extension/.output/chrome-mv3`, `--headless=new`.

---

### 1.2 Inventory of Test Files and Suites

```
tests/
├── e2e/
│   ├── harness.ts                     # Extension paths & Chromium CLI arguments
│   └── s01-login-e2e.spec.ts          # Playwright test: portal navigation & Aadhaar text presence
├── unit/
│   ├── assemble.test.ts               # Invariant I2: Region ID minting in reading order (r1, r2, r3)
│   ├── fastapi-integration.test.ts    # Spawns FastAPI, sends attested JSON, verifies PlanResponseSchema
│   ├── fingerprint.test.ts            # DOM state hashing (FNV-1a / page_state_hash)
│   ├── network-gate.test.ts           # Gatekeeper, Invariant I5 fetch ban, attestation verification
│   ├── phase1-e2e-flow.test.ts        # Perceive -> Redact -> Reason -> Act with mock PII text
│   ├── privacy-stub.test.ts           # Indian PII validators (Verhoeff Aadhaar, PAN format), redactImageCanvas
│   ├── router.test.ts                 # Confidence Router heuristics: button (HIGH), canvas (LOW), media (MEDIUM)
│   └── validator.test.ts              # Action schema validation and bounds checks
├── debug-run.ts                       # Manual Playwright execution script with console loggers
└── package.json                       # tests workspace package definition
```

#### Detailed Inspection of Existing Suites

1. **`tests/unit/router.test.ts` (183 lines)**:
   - Line 99–127 tests Invariant I6: Media elements with area $>1600\text{ px}$ route to `MEDIUM` with `needs: ['ocr', 'face']`.
   - **Observation**: It tests only the routing decision rule in TypeScript data structures. It does **not** execute any face detection inference.
2. **`tests/unit/privacy-stub.test.ts` (253 lines)**:
   - Tests Aadhaar Verhoeff D5 dihedral checksum validation (`5489 1234 5674` $\to$ valid; `0123...` $\to$ invalid).
   - Tests PAN format validation (`ABCPE1234F` $\to$ valid Individual PAN).
   - Tests text redaction token replacement (`<REDACTED_AADHAAR>`, `<REDACTED_PAN>`, `<EMAIL>`).
   - Line 134: `faces: []`.
   - **Observation**: Zero face detection or face box redaction assertions.
3. **`tests/unit/phase1-e2e-flow.test.ts` (248 lines)**:
   - Sets up mock DOM regions with Aadhaar, PAN, Email, and Phone.
   - Line 185: `faces: []`.
   - Verifies zero raw PII transmitted to the FastAPI reasoning server.
   - **Observation**: Face detection is completely omitted from the E2E unit flow.
4. **`tests/e2e/s01-login-e2e.spec.ts` (27 lines)**:
   - Launches headless Chromium with unpacked extension.
   - Navigates to `http://localhost:5173/login-demo.html`.
   - Asserts `expect(page.locator('#email-input')).toBeVisible()` and `expect(html).toContain('Aadhaar')`.
   - **Observation**: Does not assert on face detection, does not assert on privacy canvas masking, and does not verify face bounding boxes.

---

### 1.3 Developer Scripts and Scratch Items

| Script Path | Purpose & Mechanics | Relevance to Face Detection |
| :--- | :--- | :--- |
| `scripts/run-interactive.ts` | Launches Chrome with unpacked extension, fills demo credentials, clicks "Run" on the agent sidepanel, expands "Jury Audit", and extracts `masked_preview.png`. | Demonstrates live extension UI; was used to generate screenshots of masked demo page. |
| `scripts/test-perception-and-stop.ts` | Verifies state machine transitions past `PERCEIVING` state and checks that clicking the sidepanel `Stop` button aborts the task. | Tests agent execution loop responsiveness, but no direct face detection assertions. |
| `scripts/verify-fetch-ban.js` | Scans `extension/src` for illegal `fetch()` calls outside `extension/src/network/` to enforce Invariant I5. | Critical security verification for on-device isolation. |
| `scripts/check-faces.js` | Contains 4 lines (comments only). | Empty placeholder script. |
| `scripts/test-filter.js` | Contains 6 lines (comments only). | Empty scratch script. |
| `scripts/fix_mediapipe.py` | Python script that previously injected MediaPipe Tasks Vision code into `extension/src/vision/engine.ts`. | Historical evidence of prior attempt to integrate MediaPipe. |
| `test-engine.js` (root) | 21-line scratch script filtering array of DOM elements for `user-avatar`, `profile`, `face`, etc. | Prototype of the DOM-based face detection bypass. |

---

### 1.4 Test Invocation, Metrics & Output Recording

- **Test Invocation Commands**:
  - `pnpm test`: Runs `vitest run` across all unit suites.
  - `pnpm e2e`: Runs `playwright test` across `./tests/e2e/**/*.spec.ts`.
  - `pnpm --filter sih26171-extension build`: Builds extension bundle to `extension/.output/chrome-mv3`.
  - `python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000`: Runs FastAPI reasoning server.
- **Output & Metrics Recording**:
  - Vitest outputs terminal text summaries (suite name, test pass/fail count, execution duration in ms).
  - Playwright outputs to console and writes basic execution status to `test-results/.last-run.json`.
  - **Metrics Deficit**: There are currently **no automated performance benchmark recorders**, **no P95 latency tracking utilities**, **no memory leak slope analyzers**, and **no CSV/JSON reporters for inference timings**.

---

## 2. Hardware and Runtime Environment Assessment

### 2.1 Hardware Specification Matrix

```
+---------------------------------------------------------------------------------------+
| SYSTEM HARDWARE SPECIFICATION                                                         |
+----------------------+----------------------------------------------------------------+
| Host OS              | Linux 7.0.0-31-generic #31-Ubuntu SMP PREEMPT_DYNAMIC x86_64   |
| Linux Distribution   | Ubuntu 24.04 LTS (agent-s)                                     |
| CPU Model            | 12th Gen Intel(R) Core(TM) i5-12450H                           |
| CPU Topology         | 12 Logical Cores (4 Performance Cores w/ HT + 4 Efficient Cores)|
| Physical RAM         | 15,501,288 kB (15.5 GB / ~14.78 GiB)                           |
| GPU Acceleration     | NVIDIA GeForce RTX 3050 Laptop GPU (4 GB VRAM)                 |
| GPU Device Nodes     | /dev/nvidiactl, /dev/dri/card1, /dev/dri/renderD128            |
| Acceleration APIs    | Direct3D12 / Vulkan / WebGPU / OpenGL RenderD128               |
+----------------------+----------------------------------------------------------------+
```

### 2.2 Execution Environment Peculiarities and Sandboxing

1. **Snap Sandboxing (`antigravity-cli`)**:
   - The CLI agent operates inside snap confinement (`/snap/antigravity-cli/21`).
   - Standard host tools like `/usr/bin/lscpu`, `/usr/bin/mount`, and host dotfiles (`~/.bashrc`) trigger AppArmor permission denial when invoked via raw subshells.
   - Native inspection must rely on direct procfs reads (`/proc/cpuinfo`, `/proc/meminfo`) or node/python native built-ins (`os.cpus()`, `os.totalmem()`).
2. **`noexec` Mount on Workspace**:
   - `/home/agent-s/Documents/GitHub` is mounted with the `noexec` flag.
   - Binaries inside the workspace (e.g. `./server/.venv/bin/pip`, `./server/.venv/bin/python`, `./node_modules/.bin/*`) cannot be executed as standalone executables directly (`Permission denied / bad interpreter`).
   - **Required Invocation Pattern**: All commands must explicitly pass the script path to a system or environment interpreter:
     - `python3 /path/to/script.py` or `/usr/bin/python3 -m pip ...`
     - `node ./node_modules/vitest/vitest.mjs run` or `pnpm test`
3. **GPU & CUDA State in Subshell**:
   - `nvidia-smi` is not installed or not in `$PATH` in the current shell environment.
   - However, `/dev/nvidiactl` and `/dev/dri/renderD128` exist, meaning graphics render hardware is available to Chrome via standard DRI/Vulkan/WebGPU drivers.
   - Chrome running in Playwright can utilize `--enable-unsafe-webgpu` and `--use-gl=angle` / `--use-gl=egl` for hardware acceleration.

### 2.3 Machine Learning Runtimes and Model Assets

#### Present Model Assets
- **MediaPipe Tasks Vision**:
  - Model Path: `extension/public/models/blaze_face_short_range.tflite`
  - Model Size: **229,746 bytes (~224 KB)**
  - Model Format: TensorFlow Lite (TFLite, FP16/FP32 weights)
  - Target Input: $128 \times 128 \times 3$ RGB normalized tensor
  - Bundled WASM Binaries (`extension/public/mediapipe/`):
    - `vision_wasm_internal.wasm`: 11,153,617 bytes (WASM SIMD)
    - `vision_wasm_module_internal.wasm`: 11,153,641 bytes (Module loader)
    - `vision_wasm_nosimd_internal.wasm`: 10,481,398 bytes (No-SIMD fallback)
- **ONNX Runtime Web**:
  - Package: `onnxruntime-web` (v1.21.0) installed in `extension/package.json`.
  - Imported in `extension/src/vision/engine.ts:1`: `import * as ort from 'onnxruntime-web/webgpu'`.
  - Configured threads: `ort.env.wasm.numThreads = 4`, `ort.env.wasm.simd = true`.
  - **Gap**: Zero `.onnx` model files exist in the repository (`find_by_name *.onnx` $\to$ 0 results). The ONNX runtime is imported but not currently wired to any face detection graph.

### 2.4 Fallback Execution Hierarchy

```
+--------------------------------------------------------------------+
| FALLBACK HIERARCHY FOR FACE DETECTION IN EXTENSION                 |
+--------------------------------------------------------------------+
|  Level 1: WebGPU / GPU Delegate (RTX 3050 hardware acceleration)   |
|    ↓ (on delegate creation failure)                                |
|  Level 2: CPU WASM SIMD (Intel i5-12450H 4-thread SIMD)            |
|    ↓ (on WASM SIMD failure)                                        |
|  Level 3: CPU WASM No-SIMD (Universal fallback)                    |
|    ↓ (on MediaPipe initialization failure or Node.js test env)     |
|  Level 4: Explicit Safe Error / Zero Detection                     |
|           (DO NOT fall back to DOM spoofing!)                      |
+--------------------------------------------------------------------+
```

- **Current Fallback Bug in `engine.ts`**:
  Lines 26–37 return `null` if `chrome.runtime?.getURL` is undefined. Consequently, in any headless Node.js runner or Vitest suite, the detector immediately returns `null`. Then lines 128–167 kick in, falsely reporting every `<img>` on the page as a detected face.

---

## 3. Status of the 10 Failure Reproduction Categories

The authoritative specification (`ORIGINAL_REQUEST.md` R2 and `tackling face detection.md` §2) mandates a deterministic static image benchmark covering 10 distinct failure categories. Below is the comprehensive status audit of each category:

| ID | Failure Category | Description | Status in Repository | Existing Assets | Deficiencies & Root Cause Vulnerabilities |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CAT-01** | **Single Face** | One clearly visible frontal face on clean background. | **MISSING** | `login-demo.html` has Unsplash URL `photo-1494790108377-be9c29b29330` | Requires network connectivity; mocked by DOM `<img>` tag selector; no local static image fixture; no ground-truth bbox. |
| **CAT-02** | **Multiple Faces** | Group photo or meeting screenshot with 2+ faces. | **MISSING** | None | Zero multi-face fixtures; no test verifying NMS (Non-Maximum Suppression) or independent multiple bounding box redactions. |
| **CAT-03** | **Small Face** | Tiny face ($\le 80\times 80\text{ px}$ in $1920\times 1080$ screenshot, e.g. avatar, thumbnail). | **MISSING** | None | Naive downscaling (e.g. to $320\times 180$) collapses an $80\times 80$ face to $<15\text{ px}$, causing BlazeFace anchor grid failure. |
| **CAT-04** | **Large Face** | Close-up portrait filling $>40\%$ of viewport area. | **MISSING** | None | BlazeFace short-range is tuned for $\le 2\text{ meters}$; large faces can suffer bounding box clipping or fragmented anchor proposals. |
| **CAT-05** | **Partially Visible Face** | Face occluded by sidebar, boundary edge, or modal overlay. | **MISSING** | None | Bounding box coordinates may be negative or exceed image bounds; requires clipping assertions to prevent canvas crashes. |
| **CAT-06** | **Side-Profile Face** | Face rotated $\ge 45^\circ - 60^\circ$ (yaw angle). | **MISSING** | None | Frontal detectors have low confidence on profiles; requires empirical confidence threshold tuning ($0.30 - 0.50$). |
| **CAT-07** | **Webpage Screenshot** | Full full-page UI ($1920\times 1080$) containing banner, text, cards, and embedded face. | **MISSING** | Only 4 unrelated screenshots in root (`pan identity leaked.jpeg`, etc.) | Tests coordinate translation across browser viewport, DPR scaling, and canvas redaction on realistic page layouts. |
| **CAT-08** | **Image Element** | Face embedded inside standard HTML `<img>`, `<picture>`, or CSS background. | **MISSING** | Mocked in `login-demo.html` | Pipeline must prove it detects the face from the visual screenshot pixels, not by reading the DOM bounding box of the element. |
| **CAT-09** | **Dynamic Render** | Face rendered dynamically via HTML5 `<canvas>`, SVG, or WebGL without DOM `<img>` tag. | **MISSING** | None | The existing DOM heuristic completely fails on dynamic canvas/WebGL renders because there is no `<img>` tag to cheat from. |
| **CAT-10** | **No-Face Image** | Negative control (pure text, buttons, charts, documents, drawings, icons). | **MISSING** | None | Must verify zero false positives; system must return `faces: []` without throwing exceptions or applying spurious black redaction boxes. |

---

## 4. Root Cause Failure Classification

Following the classification framework in `tackling face detection.md` §3 and `ORIGINAL_REQUEST.md` R3:

```
+------------------------------------------------------------------------------------------------+
| FAILURE MODE CLASSIFICATION                                                                    |
+------+-----------------------+-----------------------------------------------------------------+
| Mode | Symptom               | Codebase Evidence & Root Cause                                  |
+------+-----------------------+-----------------------------------------------------------------+
| A    | Model fails to detect | 1. `typeof chrome === 'undefined'` in `engine.ts:26-37` causes   |
|      | the face              |    `initFaceDetector()` to return null outside Chrome.         |
|      |                       | 2. WebGPU delegate initialization fails in non-GPU contexts.    |
|      |                       | 3. High-resolution input ($1920\times 1080$) without proper    |
|      |                       |    letterboxing/scaling causes small faces to fall outside      |
|      |                       |    BlazeFace anchor receptive fields.                           |
+------+-----------------------+-----------------------------------------------------------------+
| B    | Face detected, but    | 1. **DOUBLE-SCALING BUG**: Contract in `vision.ts:26` mandates  |
|      | bounding box is wrong |    `FaceBox.bbox` in CSS px. MediaPipe returns physical bitmap  |
|      | (Redaction misplaced) |    px. `engine.ts` pushed physical px directly.                 |
|      |                       | 2. `privacy.stub.ts:redactImageCanvas()` multiplied `box.x` by  |
|      |                       |    `scaleX = bitmap.width / viewport.w` ($= \text{dpr}$).       |
|      |                       |    On DPR=1.5, coordinates are scaled by $1.5^2 = 2.25$,       |
|      |                       |    misplacing redaction off-target.                             |
+------+-----------------------+-----------------------------------------------------------------+
| C    | Face detected only    | 1. Hardcoded confidence thresholding without validation.        |
|      | sometimes (flaky)     | 2. Input aspect ratio distortion when resizing screenshots to   |
|      |                       |    square tensors without letterbox padding.                    |
+------+-----------------------+-----------------------------------------------------------------+
| D    | Accurate but too slow | 1. 800 ms forced rate limit in `screenshot.ts:16-20`.           |
|      | (violates <500ms SIH) | 2. Full $1920\times 1080$ bitmap decoded via single-threaded    |
|      |                       |    JavaScript `atob()` charCode loops.                          |
|      |                       | 3. Passing raw unscaled 1080p images to vision tasks.           |
+------+-----------------------+-----------------------------------------------------------------+
```

---

## 5. Baseline Performance Benchmark Methodology

To satisfy Requirements R4, R5 and Acceptance Criteria 37–43, the following benchmark harness and measurement protocols must be established:

### 5.1 End-to-End Perception Latency Path

The SIH sub-500 ms target applies to the **entire perception chain**, not just isolated model inference:

$$\text{Latency}_{\text{perception}} = T_{\text{capture}} + T_{\text{preprocess}} + T_{\text{inference}} + T_{\text{postprocess}} + T_{\text{coord\_transform}} + T_{\text{redaction}}$$

```
+-------------------------------------------------------------------------------------+
| COMPLETE PERCEPTION PATH BUDGET ALLOCATION (Target: < 500 ms)                       |
+------------------------------------+------------------+-----------------------------+
| Stage                              | Target Budget    | Implementation Strategy     |
+------------------------------------+------------------+-----------------------------+
| 1. Screenshot Capture              | $\le 100\text{ ms}$ | Remove 800ms artificial rate limit; use active tab capture |
| 2. Controlled Resize & Preprocess  | $\le 30\text{ ms}$  | OffscreenCanvas downscale to $640\times 360$; zero-copy uint8 |
| 3. Neural Face Inference           | $\le 45\text{ ms}$  | MediaPipe WebGPU or WASM SIMD (Intel i5 / RTX 3050) |
| 4. BBox Extraction & Filtering     | $\le 10\text{ ms}$  | NMS and confidence threshold filtering ($\ge 0.50$) |
| 5. Coordinate Inverse Mapping      | $\le 5\text{ ms}$   | Map detector coords $\to$ CSS px $\to$ screenshot canvas px |
| 6. Privacy Redaction Rendering     | $\le 40\text{ ms}$  | OffscreenCanvas solid fill + badge overlay |
| TOTAL PERCEPTION PIPELINE          | $\le 230\text{ ms}$ | **Comfortably satisfies < 500 ms SIH requirement!** |
+------------------------------------+------------------+-----------------------------+
```

### 5.2 Controlled Perception Resolutions Evaluation Matrix

The benchmark must evaluate five controlled perception resolutions while preserving the original screenshot aspect ratio ($16:9$):

| Resolution | Aspect Ratio | Total Pixels | Relative Pixel Load | Expected Inference Latency | Detection Quality (Small Faces) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **$320 \times 180$** | 16:9 | 57,600 | 2.8% of 1080p | $\sim 12\text{ ms}$ | Poor (misses faces $<80\text{ px}$) |
| **$416 \times 234$** | 16:9 | 97,344 | 4.7% of 1080p | $\sim 18\text{ ms}$ | Moderate |
| **$512 \times 288$** | 16:9 | 147,456 | 7.1% of 1080p | $\sim 25\text{ ms}$ | Good |
| **$640 \times 360$** (Recommended) | 16:9 | 230,400 | 11.1% of 1080p | $\sim 35\text{ ms}$ | **Optimal Balance** (detects down to $30\text{ px}$) |
| **$640 \times 480$** | 4:3 | 307,200 | 14.8% of 1080p | $\sim 48\text{ ms}$ | Distorts 16:9 screenshots |

### 5.3 Hardware Resource & Memory Leak Measurement Protocol

1. **Latency Percentile Calculation (100 Iterations)**:
   - Run 100 consecutive image inferences using high-resolution timer (`performance.now()`).
   - Discard first 5 warmup iterations.
   - Sort latency array:
     - **P50 (Median)**: `latencies[Math.floor(N * 0.50)]`
     - **P95**: `latencies[Math.floor(N * 0.95)]`
     - **P99**: `latencies[Math.floor(N * 0.99)]`
     - **Max**: `latencies[N - 1]`
2. **RAM & VRAM Tracking**:
   - **Node.js Benchmark**: Record `process.memoryUsage().heapUsed`, `heapTotal`, `rss`, and `arrayBuffers` at iterations 0, 25, 50, 75, 100.
   - **Browser/Extension Benchmark**: Record `performance.memory.usedJSHeapSize` and CDP `Performance.getMetrics` (`JSHeapUsedSize`).
   - **VRAM Tracking**: Track WebGPU device memory allocation or offscreen canvas buffer reuse.
3. **Memory Leak Slope Analysis**:
   - Compute linear regression slope of heap usage from iteration 10 to 100:
     $$\text{Slope} = \frac{\Delta \text{Heap (MB)}}{\Delta \text{Iterations}}$$
   - **Acceptance Threshold**: $\text{Slope} < 0.05\text{ MB/iteration}$. If heap increases monotonically without leveling off, flag unreleased `ImageBitmap` or uncollected tensor buffers.
4. **Session Re-use vs Reload Verification**:
   - Assert that model load time occurs **only on iteration 1**.
   - If iteration 1 is $\sim 150\text{ ms}$ and iterations 2–100 are consistently $\le 40\text{ ms}$, session reuse is verified. If all iterations take $>120\text{ ms}$, flag redundant model re-instantiation.

---

## 6. Actionable Implementation & Test Harness Recommendations

To address all identified deficiencies, the subsequent implementation phase should execute the following plan:

### 6.1 Create Deterministic Static Test Fixture Suite
- Create directory `tests/fixtures/face-test-suite/` containing 10 deterministic static PNG images corresponding to CAT-01 through CAT-10.
- Create accompanying `ground-truth.json` specifying expected face counts and bounding box regions in CSS pixels:
  ```json
  {
    "cat_01_single_face.png": { "expected_faces": 1, "approx_bbox": [240, 120, 160, 160] },
    "cat_02_multi_faces.png": { "expected_faces": 3 },
    "cat_03_small_face.png": { "expected_faces": 1, "max_dim": 80 },
    "cat_10_no_face.png": { "expected_faces": 0 }
  }
  ```

### 6.2 Establish Standalone Face Detection Unit & Benchmark Suite
- Create `tests/unit/face-detector.test.ts` (Vitest):
  - Load MediaPipe with local WASM and `blaze_face_short_range.tflite` directly using Node-compatible file buffers or an OffscreenCanvas polyfill.
  - Run all 10 categories, asserting correct face counts and valid bounding box ranges.
  - Assert zero false positives on `cat_10_no_face.png`.
- Create `tests/benchmarks/face-benchmark.ts`:
  - Execute the 100-image benchmark sequence.
  - Output the official benchmark card (§20 of `tackling face detection.md`) with Preprocessing, Inference, Postprocessing, Total Latency, P50, P95, P99, RAM, and Memory Leak Slope.

### 6.3 Fix Coordinate Transformation & Redaction Bugs
- In `extension/src/vision/engine.ts`:
  - When MediaPipe returns `det.boundingBox` in physical pixels of `imgBitmap`, convert to CSS pixels immediately before pushing to `faces`:
    ```typescript
    const cssX = det.boundingBox.originX / dpr;
    const cssY = det.boundingBox.originY / dpr;
    const cssW = det.boundingBox.width / dpr;
    const cssH = det.boundingBox.height / dpr;
    ```
  - When controlled perception resolution is used ($640\times 360$), apply inverse resolution scale factor ($S_x = W_{\text{orig}} / 640$, $S_y = H_{\text{orig}} / 360$) before CSS normalization.
  - **Completely remove lines 128–167** that falsely classified all HTML `<img>` elements as faces.
- In `extension/src/privacy.stub.ts`:
  - Maintain coordinate contract: input `box` is strictly in CSS pixels, scaled by `scaleX = bitmap.width / viewport.w` to reach physical canvas coordinates.

---

## 7. Report Verification & Artifact References

- Authoritative User Request: `/home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md`
- Master Diagnostic Guide: `/home/agent-s/Documents/GitHub/tackling face detection.md`
- Specification Report: `/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/spec_report.md`
- Pipeline Survey Report: `/home/agent-s/Documents/GitHub/.agents/survey_explorer_1/pipeline_analysis.md`
- Working Memory & Log: `/home/agent-s/Documents/GitHub/.agents/survey_explorer_2/BRIEFING.md` & `progress.md`
