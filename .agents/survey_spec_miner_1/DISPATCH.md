## 2026-09-22T20:03:52Z
You are survey_spec_miner_1, a specification mining subagent.
Working Directory: /home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1 (create this folder if it doesn't exist, create BRIEFING.md and progress.md there).
Your Parent: teamwork_preview_orchestrator_1 (conversation ID: b6e4823e-0b2d-4eba-a348-fdd572bd65bb).
Authoritative User Request: /home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md

Mission: Extract all functional, performance, accuracy, and system requirements for SIH 2026 Problem Statement 26171.
Instructions:
1. Read /home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md, `tackling face detection.md`, and any existing documentation/specs in /home/agent-s/Documents/GitHub and ~/teamwork_projects/sih_face_detection.
2. Enumerate every requirement:
   - R1: Pipeline understanding requirements.
   - R2: Deterministic test set (10 categories: single face, multiple faces, small, large, partial, side-profile, webpage screenshot, image element, dynamic render, no-face).
   - R3: Failure categories (A: Model fails, B: Bounding box wrong, C: Detected sometimes, D: Too slow) and root cause criteria.
   - R4: Resolution optimization (e.g. 640x360), coordinate mapping back to original dimensions, lightweight models, quantization formats (INT8, FP16, FP32), session reuse.
   - R5: Resource utilization (CPU, GPU, RAM, VRAM), memory copy minimization, batch size minimization, screenshot coordinate transformations, complete redaction coverage, CPU fallback on GPU failure, DOM perception non-regression.
   - All 16 Acceptance Criteria from ORIGINAL_REQUEST.md.
   - SIH sub-500ms latency target and P95 measurement.
   - 100-image benchmark criteria and memory leak detection.
3. Structure an exhaustive requirement inventory and traceability matrix in `/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/spec_report.md` and write your handoff report to `/home/agent-s/Documents/GitHub/.agents/survey_spec_miner_1/handoff.md`.
4. Send a message to parent when complete.
