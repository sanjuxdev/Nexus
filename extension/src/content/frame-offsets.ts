export function getLocalFrameOffset(): [number, number] {
  if (typeof window === 'undefined') return [0, 0];

  try {
    if (window.self === window.top) {
      return [0, 0];
    }

    if (window.frameElement) {
      const rect = window.frameElement.getBoundingClientRect();
      return [rect.left, rect.top];
    }
  } catch {
    // Cross-origin iframe frameElement access will throw SecurityError.
    // The service worker will compose cross-origin offsets using webNavigation frame hierarchy.
  }

  return [0, 0];
}

/**
 * Compose nested frame offsets by summing parent offsets.
 */
export function composeFrameOffsets(
  frameId: string,
  frames: { frame_id: string; parent_frame_id: string | null; offset: [number, number] }[]
): [number, number] {
  let cur: { frame_id: string; parent_frame_id: string | null; offset: [number, number] } | undefined =
    frames.find((f) => f.frame_id === frameId);

  let totalX = 0;
  let totalY = 0;

  const visited = new Set<string>();

  while (cur && !visited.has(cur.frame_id)) {
    visited.add(cur.frame_id);
    totalX += cur.offset[0];
    totalY += cur.offset[1];

    if (!cur.parent_frame_id) break;
    cur = frames.find((f) => f.frame_id === cur?.parent_frame_id);
  }

  return [totalX, totalY];
}
