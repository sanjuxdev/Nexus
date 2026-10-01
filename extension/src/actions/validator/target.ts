import type {
  BBox,
  RegionIndexEntry,
  StructuredAction,
  TargetResolution,
  TaskSession,
} from '@contracts/index.js';

const BBOX_DRIFT_TOLERANCE_PX = 32;

export function validateTarget(
  action: StructuredAction,
  session: TaskSession,
  resolution?: TargetResolution
): { ok: boolean; reason?: string } {
  if (!action.target) {
    // Actions like scroll may not have a target
    return { ok: true };
  }

  const regionId = action.target.region_id;

  // Invariant I7: Server can only reference region_ids it was shown in that request
  const entry: RegionIndexEntry | undefined = session.region_index[regionId];
  if (!entry) {
    return {
      ok: false,
      reason: `Unknown target region_id "${regionId}". Target does not exist in session region index.`,
    };
  }

  if (resolution && !resolution.exists) {
    return {
      ok: false,
      reason: `Target element for region_id "${regionId}" not found in active DOM.`,
    };
  }

  return { ok: true };
}

export function validateVisibilityAndInteractability(
  action: StructuredAction,
  session: TaskSession,
  resolution?: TargetResolution
): { ok: boolean; reason?: string } {
  if (!action.target) return { ok: true };

  const regionId = action.target.region_id;
  const entry = session.region_index[regionId];

  if (resolution) {
    if (!resolution.visible) {
      return {
        ok: false,
        reason: `Target element "${regionId}" is not visible.`,
      };
    }

    if (resolution.occluded) {
      return {
        ok: false,
        reason: `Target element "${regionId}" is occluded by another element.`,
      };
    }

    if (!resolution.interactable) {
      return {
        ok: false,
        reason: `Target element "${regionId}" is not interactable (e.g. disabled).`,
      };
    }

    // Verify bounding box drift
    if (entry) {
      const [ex, ey] = entry.bbox;
      const [rx, ry] = resolution.bbox;
      const drift = Math.hypot(ex - rx, ey - ry);
      if (drift > BBOX_DRIFT_TOLERANCE_PX) {
        return {
          ok: false,
          reason: `Target element drifted excessively from perceived coordinates (${Math.round(drift)}px > ${BBOX_DRIFT_TOLERANCE_PX}px)`,
        };
      }
    }
  }

  return { ok: true };
}
