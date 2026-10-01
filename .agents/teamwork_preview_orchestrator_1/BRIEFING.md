# BRIEFING — 2026-09-23T01:34:00+05:30

## Mission
Diagnose and fix face detection performance and accuracy for SIH 2026 Problem Statement 26171 (On-device Visual Perception).

## 🔒 My Identity
- Archetype: teamwork_preview_orchestrator
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: /home/agent-s/Documents/GitHub/.agents/teamwork_preview_orchestrator_1
- Original parent: parent
- Original parent conversation ID: cea1438f-cfdc-432d-8b25-7fc16c9ab4e9

## 🔒 My Workflow
- **Pattern**: Project
- **Scope document**: /home/agent-s/Documents/GitHub/PROJECT.md
1. **Decompose**: Decompose full SIH visual perception problem into milestones based on module boundaries and requirements R1-R5.
2. **Dispatch & Execute**:
   - **Delegate (sub-orchestrator)**: Delegate milestones and E2E testing track to sub-orchestrators/specialists following Project Pattern.
3. **On failure** (in this order):
   - Retry: nudge stuck agent or re-send task
   - Replace: spawn fresh agent with partial progress
   - Skip: proceed without (only if non-critical)
   - Redistribute: split stuck agent's remaining work
   - Redesign: re-partition decomposition
   - Escalate: report to parent (sub-orchestrators only, last resort)
4. **Succession**: At 16 spawns, write handoff.md, spawn successor
- **Work items**:
  1. Survey & Codebase Exploration [in-progress]
  2. Test Suite & Reproduction Harness [pending]
  3. Pipeline & Failure Diagnosis [pending]
  4. Model & Resolution Optimization [pending]
  5. Resource Optimization & Transformation [pending]
  6. E2E Verification & SIH Benchmark [pending]
- **Current phase**: 0 (Survey)
- **Current focus**: Surveying existing codebase and specifications via Explorers and Spec Miner

## 🔒 Key Constraints
- DISPATCH-ONLY orchestrator: NEVER write/modify source code or run build/tests directly. Delegate ALL work.
- File edits restricted ONLY to metadata/state files (.md) in .agents/.
- Forensic audit binary veto: INTEGRITY VIOLATION means failure.
- Never reuse a subagent after it has delivered its handoff — always spawn fresh.

## Current Parent
- Conversation ID: cea1438f-cfdc-432d-8b25-7fc16c9ab4e9
- Updated: 2026-09-23T01:30:10+05:30

## Key Decisions Made
- Initiated Project Pattern with Survey phase (2 Explorers + 1 Spec Miner).

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| survey_explorer_1 | teamwork_preview_explorer | Survey current perception pipeline (R1) | in-progress | a7dfe6cf-eb7a-4ca5-a988-e21a84ee95ae |
| survey_spec_miner_1 | teamwork_preview_spec_miner | Survey & mine SIH specifications | in-progress | 28b5c57b-4422-48b4-9313-3cc5fcd7c6a9 |
| survey_explorer_2 | teamwork_preview_explorer | Survey test harness & hardware env (R2/R3) | in-progress | 16ae827a-b89a-4c98-a4b3-98a29fe7cfcd |

## Succession Status
- Succession required: no
- Spawn count: 3 / 16
- Pending subagents: a7dfe6cf-eb7a-4ca5-a988-e21a84ee95ae, 28b5c57b-4422-48b4-9313-3cc5fcd7c6a9, 16ae827a-b89a-4c98-a4b3-98a29fe7cfcd
- Predecessor: none
- Successor: not yet spawned

## Active Timers
- Heartbeat cron: b6e4823e-0b2d-4eba-a348-fdd572bd65bb/task-12
- Safety timer: none
- On succession: kill all timers before spawning successor
- On context truncation: run `manage_task(Action="list")` — re-create if missing

## Artifact Index
- /home/agent-s/Documents/GitHub/.agents/ORIGINAL_REQUEST.md — Authoritative User Request
- /home/agent-s/Documents/GitHub/.agents/teamwork_preview_orchestrator_1/DISPATCH.md — Dispatch log
- /home/agent-s/Documents/GitHub/.agents/teamwork_preview_orchestrator_1/BRIEFING.md — Working memory & state
- /home/agent-s/Documents/GitHub/.agents/teamwork_preview_orchestrator_1/progress.md — Execution & liveness tracker
