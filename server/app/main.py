"""
Minimal FastAPI Reasoning & Planning Server for SIH 2026 PS 26171
Location: server/app/main.py
"""

import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="SIH 2026 PS 26171 Reasoning Planner",
    description="Privacy-preserving reasoning engine receiving sanitized context from browser agents.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY_SECRET = os.getenv("API_KEY", "dev-key")


@app.get("/healthz")
def health_check():
    return {"status": "ok", "service": "sih26171-planner", "time": time.time()}


@app.post("/v1/plan")
async def plan_step(request: Request, x_api_key: Optional[str] = Header(None)):
    start_time = time.time()

    # 1. Authenticate Request
    if x_api_key and x_api_key != API_KEY_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key"
        )

    raw_body = await request.body()
    try:
        data = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed JSON in request body",
        )

    # The body could be an AttestedPayload ({ request_id, body, sha256, issued_at })
    # or the SanitizedContext directly (since gate.ts sends body: attested.body)
    if "sha256" in data and "body" in data and isinstance(data["body"], str):
        # Invariant I5: Verify SHA-256 digest
        calculated_digest = hashlib.sha256(data["body"].encode("utf-8")).hexdigest()
        if calculated_digest != data["sha256"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attestation violation: Digest mismatch. Body was altered in transit.",
            )
        try:
            context = json.loads(data["body"])
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Malformed context in attested body",
            )
        request_id = data.get(
            "request_id", context.get("request_id", f"req_{int(time.time())}")
        )
    else:
        context = data
        request_id = context.get("request_id", f"req_{int(time.time())}")

    regions = context.get("regions", [])
    page = context.get("page", {})
    origin = page.get("origin", "http://localhost:5173")
    frame_ids = page.get("frame_ids", ["main"])
    frame_id = frame_ids[0] if frame_ids else "main"
    page_state_hash = page.get("page_state_hash", "")

    print(f"[Planner] Received {len(regions)} regions:")
    for r in regions:
        print(f"  - id={r.get('region_id')} type={r.get('type')} text={repr(r.get('text'))} interactable={r.get('interactable')}")

    # Check if goal is already completed
    # (Disabled so the vision model runs continuously until manually stopped)
    # history = context.get("history", [])
    # has_clicked = any(
    #     h.get("action") == "click" and h.get("result") == "ok" for h in history
    # )
    # auth_success = any(
    #     "authentication successful" in (r.get("text") or "").lower()
    #     or "welcome" in (r.get("text") or "").lower()
    #     for r in regions
    # )
    #
    # if has_clicked or auth_success:
    #     server_ms = max(1, int((time.time() - start_time) * 1000))
    #     return {
    #         "request_id": request_id,
    #         "status": "done",
    #         "action": None,
    #         "message": "Task completed successfully. Authentication achieved.",
    #         "usage": {"server_ms": server_ms, "model": "heuristic-planner-v1"},
    #     }

    # Goal-directed planning logic:
    # Look for interactable button / action element
    button_region = None
    for r in regions:
        text = (r.get("text") or "").lower()
        rtype = r.get("type")
        interactable = r.get("interactable", True)
        if rtype == "button" and interactable:
            if "sign in" in text or "login" in text or "submit" in text:
                button_region = r
                break

    if not button_region:
        for r in regions:
            if r.get("type") == "button" and r.get("interactable", True):
                button_region = r
                break

    if not button_region:
        for r in regions:
            text = (r.get("text") or "").lower()
            rtype = r.get("type")
            interactable = r.get("interactable", True)
            if interactable and rtype in ("link", "custom_control") and ("sign in" in text or "login" in text):
                button_region = r
                break

    target_region_id = (
        button_region.get("region_id")
        if button_region
        else (regions[0].get("region_id") if regions else "r1")
    )
    print(f"[Planner] Selected target: {target_region_id} (button_region: {button_region})")

    task = context.get("task", "").lower()
    action_type = "click"
    if "scroll" in task:
        action_type = "scroll"
    elif "type" in task or "enter" in task:
        action_type = "type"

    action = {
        "action_id": f"act_{int(time.time() * 1000)}",
        "request_id": request_id,
        "action": action_type,
        "target": {"region_id": target_region_id},
        "params": None,
        "capability": None,
        "origin": origin,
        "frame_id": frame_id,
        "page_state_hash": page_state_hash,
        "rationale": f"Executing {action_type} on target {target_region_id} on {origin}",
    }

    server_ms = max(1, int((time.time() - start_time) * 1000))

    return {
        "request_id": request_id,
        "status": "action",
        "action": action,
        "message": "Structured action planned successfully from sanitized context",
        "usage": {"server_ms": server_ms, "model": "heuristic-planner-v1"},
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
