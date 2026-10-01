# BRIEFING — 2026-09-23T01:45:00+05:30

## Mission
Map the complete current visual perception & face detection pipeline for SIH 2026 Problem Statement 26171 (Requirement R1).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, synthesizer
- Working directory: /home/agent-s/Documents/GitHub/.agents/survey_explorer_1
- Original parent: b6e4823e-0b2d-4eba-a348-fdd572bd65bb
- Milestone: SIH 2026 Problem Statement 26171 - Visual Perception & Face Detection Pipeline Survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Analyze problems, synthesize findings, produce structured reports
- Document findings in pipeline_analysis.md and handoff.md

## Current Parent
- Conversation ID: b6e4823e-0b2d-4eba-a348-fdd572bd65bb
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `extension/src/capture/screenshot.ts` (screenshot capture, format, dimensions, 800ms throttle)
  - `extension/src/vision/engine.ts` (MediaPipe BlazeFace Short Range, WASM runtime, DOM fallback heuristic)
  - `extension/src/privacy.stub.ts` and `extension/src/privacy/engine.ts` (canvas 2D blackout, scaleX/Y math, double scaling bug)
  - `extension/src/background/orchestrator.ts` and `assemble-frame.ts` (orchestration loop, IoU fusion, reading-order ID minting)
  - `server/app/main.py` (FastAPI planner, zero-PII attestation verification, structured action response)
  - `contracts/ts/` (perception, vision, privacy, geometry, schemas)
  - `ROADMAP.md`, `SANITIZATION_MAP.md`, `JURY_SCHEMATICS.md`, `tackling face detection.md`
- **Key findings**:
  - Face detection uses MediaPipe `blaze_face_short_range.tflite` (229.7 KB) with 11.15 MB WASM runtime.
  - MediaPipe outputs physical pixels (`w*dpr, h*dpr`), but `FaceBox` contract requires CSS pixels.
  - `redactImageCanvas()` multiplies boxes by `scaleX = dpr`, resulting in a double-scaling bug ($\text{dpr}^2$) on high-DPI displays.
  - `visionEngine` has a heuristic DOM fallback that masks any `<img>` tag as a face with 0.98 confidence.
  - End-to-end perception latency is 940–1300 ms (throttled by 800 ms sleep in `captureScreenshot`).
  - Server is strictly a downstream heuristic planner; it executes no CV or face detection.
- **Unexplored areas**: None for R1 survey scope.

## Key Decisions Made
- Completed full technical survey and documented in `pipeline_analysis.md`.
- Formulated 5-component hard handoff in `handoff.md`.

## Artifact Index
- /home/agent-s/Documents/GitHub/.agents/survey_explorer_1/DISPATCH.md — Dispatch record
- /home/agent-s/Documents/GitHub/.agents/survey_explorer_1/BRIEFING.md — Working memory & identity
- /home/agent-s/Documents/GitHub/.agents/survey_explorer_1/progress.md — Liveness & progress tracker
- /home/agent-s/Documents/GitHub/.agents/survey_explorer_1/pipeline_analysis.md — Technical findings report
- /home/agent-s/Documents/GitHub/.agents/survey_explorer_1/handoff.md — 5-component handoff report
