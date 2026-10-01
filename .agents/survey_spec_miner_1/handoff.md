# Handoff Report: Specification Mining for SIH 2026 Problem Statement 26171

- **Agent:** `survey_spec_miner_1` (Specification Miner)
- **Recipient:** `teamwork_preview_orchestrator_1` (Parent Conversation ID: `b6e4823e-0b2d-4eba-a348-fdd572bd65bb`)
- **Date:** 2026-09-23T01:43:00+05:30
- **Artifact Generated:** `/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/spec_report.md`

---

## 1. Observation

1. **Authoritative Specification Corpus:**
   - Inspected `/home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md` (lines 10–47), defining core requirements R1–R5 and 16 distinct Acceptance Criteria for SIH 2026 PS 26171.
   - Inspected `/home/agent-s/Documents/GitHub/tackling face detection.md` (all 1,012 lines across 25 sections), containing exhaustive requirements for pipeline auditing (§1), 10 deterministic test categories (§2), 4 failure classifications (§3), resolution optimization & coordinate mapping (§4, §17), model sizing & quantization formats (§5, §6), resource targets & RTX 3050 constraints (§7, §8), session reuse (§10), memory management (§11), sub-500ms latency path (§13), complete redaction (§18), false-positive negative controls (§19), 100-image benchmark card schema (§20), CPU/GPU comparison (§21), hardware fallbacks (§22), and DOM perception non-regression (§23).
   - Inspected `/home/agent-s/Documents/GitHub/readme files/ps analysis.md` (lines 95–118), detailing the official 5-dimensional evaluation rubric: D1 (Visual Accuracy, 25%), D2 (PII Detection Recall & Precision, 20%), D3 (Redaction Precision, 20%), D4 (Client Resource Utilization, 20%), D5 (End-to-End Latency, 15%).
   - Inspected `/home/agent-s/Documents/GitHub/readme files/02_MEMBER_2_LOCAL_VISION_AND_PERCEPTION.md` (lines 1–288), specifying ONNX Runtime Web (`onnxruntime-web/webgpu`), WebGPU $\to$ WebGL $\to$ WASM SIMD execution provider hierarchy, coordinate standards (image pixels vs CSS pixels), and model store requirements.

2. **Existing Codebase Reality & Model Assets:**
   - Inspected `extension/src/vision/engine.ts` (lines 18–66, 87–127): Discovered that `initFaceDetector()` attempts to load `@mediapipe/tasks-vision` with `models/blaze_face_short_range.tflite` with a GPU delegate fallback to CPU. However, lines 128–167 contain a temporary DOM fallback scanning `req.dom.elements` for `<img>`/`<svg>` tags, indicating the neural detector was either unverified, unstable, or bypassed.
   - Inspected `extension/public/models/`: Found `blaze_face_short_range.tflite` (229,746 bytes, ~230 KB).
   - Inspected `extension/public/mediapipe/`: Verified bundled local WASM files `vision_wasm_internal.wasm` (11,153,617 bytes), `vision_wasm_module_internal.wasm` (11,153,641 bytes), and `vision_wasm_nosimd_internal.wasm` (10,481,398 bytes).
   - Searched for ONNX models (`find_by_name *.onnx`): Returned 0 results. No `.onnx` face model currently exists in the repository.
   - Inspected `extension/src/privacy.stub.ts` (lines 85–189, 536–574): Verified canvas redaction implementation `redactImageCanvas()` using `OffscreenCanvas` 2D context, 4px CSS safety padding scaled by DPR (`padX = 4 * scaleX`), `#000000` solid blackout fill, `#ef4444` crimson red border, and `[FACE]` badge text rendering.
   - Inspected `contracts/ts/vision.ts` (lines 23–26): Verified contract interface `FaceBox { bbox: BBox; confidence: number; }` documented explicitly in CSS pixels.
   - Inspected directory structures: Verified that `~/teamwork_projects/sih_face_detection` does not exist on disk, and the active codebase resides in `/home/agent-s/Documents/GitHub`.

---

## 2. Logic Chain

1. **Derivation of Requirements Baseline:**
   - From `ORIGINAL_REQUEST.md` and `tackling face detection.md` §1–§25, Problem Statement 26171 establishes a strict edge-partitioned architecture where face detection is a static screenshot perception problem, not a webcam/streaming detector.
   - The primary performance objective is defined not as maximum GPU utilization, but as *maximum useful perception performance per unit of CPU/GPU/RAM/VRAM* while maintaining reliable detection.
2. **Identification of Testing & Benchmark Requirements:**
   - To prevent subjective evaluation, `tackling face detection.md` §2 mandates a deterministic static test set across 10 distinct categories (CAT-01 to CAT-10). Currently, no dedicated test harness or dataset directory for these 10 categories exists in `tests/`.
   - The 100-image benchmark (§20) requires measuring full perception latency across P50, P95, P99, and Max, while verifying JS Heap stabilization (slope $< 0.05\text{ MB/iter}$) to prevent memory leaks during repeated browser-agent sessions.
3. **Identification of Root Cause Diagnostic Rules:**
   - Failures must be systematically categorized into Category A (Model fails), Category B (Bounding box offset), Category C (Flaky detection), or Category D (Latency failure).
   - In particular, Category B often stems from confusing CSS pixels, canvas bitmap pixels, and DPR scaling, rather than neural network errors.
4. **Resolution Scaling & Coordinate Mapping Math:**
   - Feeding raw $1920 \times 1080$ screenshots to the detector violates latency and memory constraints. Controlled perception resolutions ($640 \times 360$) must be used, coupled with mathematical inverse coordinate mapping back to original coordinates ($S_x = W_{\text{orig}}/W_{\text{det}}$, $S_y = H_{\text{orig}}/H_{\text{det}}$).
5. **Hardware Fallback & Non-Regression:**
   - The system must seamlessly fall back from WebGPU to CPU (WASM SIMD) if GPU initialization fails, and must never regress the existing DOM perception pipeline or Playwright browser-agent workflows.

---

## 3. Caveats

- **Physical Model Execution in Subagent Environment:** As a specification miner operating in a read-only survey role, I extracted all requirements and architectural constraints from documentation and code, but did not execute heavy GPU/WASM model inference sessions or live browser launches.
- **Teamwork Projects Path:** The path `~/teamwork_projects/sih_face_detection` referenced in `ORIGINAL_REQUEST.md` does not exist on disk; all active files, extension bundles, server scripts, and tests are located under `/home/agent-s/Documents/GitHub`.
- **Model Formats:** Currently, only `blaze_face_short_range.tflite` is present in `extension/public/models/`. If ONNX Runtime Web is preferred or evaluated alongside MediaPipe, an ONNX face detector (such as UltraFace-RFB or YuNet ~1MB) will need to be downloaded or exported.

---

## 4. Conclusion

All functional, performance, accuracy, and system requirements for SIH 2026 Problem Statement 26171 have been comprehensively extracted, structured, and cross-referenced.

The complete requirement inventory and traceability matrix is documented in:
`/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/spec_report.md`

Key findings for downstream orchestrator milestones:
1. **Requirements Coverage:** R1 through R5, the 10 deterministic test categories, the 4 failure modes, and all 16 Acceptance Criteria are fully detailed with concrete verification procedures.
2. **Performance Bounds:** End-to-end perception latency (capture + preprocess + inference + postprocess + coordinate map + redaction) must stay strictly below $500\text{ ms}$ (P95 target), with peak RAM $< 150\text{ MB}$.
3. **Actionable Roadmap:** The downstream team needs to (a) build the deterministic 10-category static test suite, (b) benchmark controlled resolution scaling ($640 \times 360$) with inverse coordinate mapping, (c) verify the resident session lifecycle, (d) validate CPU fallback on GPU failure, and (e) run the 100-image benchmark card with memory leak slope verification.

---

## 5. Verification Method

To independently verify this specification inventory and the underlying codebase state:

1. **Verify Generated Reports:**
   - Inspect `/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/spec_report.md` for complete requirement coverage and traceability matrix.
   - Inspect `/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/BRIEFING.md` and `progress.md`.
2. **Verify Codebase Ground Truth:**
   - Confirm present model assets: `ls -la /home/agent-s/Documents/GitHub/extension/public/models/`
   - Confirm bundled WASM files: `ls -la /home/agent-s/Documents/GitHub/extension/public/mediapipe/`
   - Verify existing test suite baseline:
     ```bash
     cd /home/agent-s/Documents/GitHub && pnpm test
     ```
   - Verify TypeScript typecheck:
     ```bash
     cd /home/agent-s/Documents/GitHub && pnpm --filter sih26171-extension exec tsc --noEmit
     ```
3. **Invalidation Conditions:**
   - This specification report is invalidated if ISRO updates Problem Statement 26171 evaluation rubrics, if the project shifts to video/streaming face detection, or if `ORIGINAL_REQUEST.md` constraints are altered.
