import type { BBox, DomElementInfo, FrameInfo } from '@contracts/index.js';
import { roundBBoxToStep } from '@contracts/geometry.js';
import { canonicalJson, sha256Hex } from '../../security/sha256.js';

export interface FingerprintOptions {
  mode?: 'strict' | 'target-scoped';
  targetBBox?: BBox;
}

export async function computePageStateHash(
  origin: string,
  path: string,
  frames: FrameInfo[],
  elements: DomElementInfo[],
  scrollY = 0,
  options: FingerprintOptions = {}
): Promise<string> {
  const scrollBucket = Math.floor(scrollY / 64);
  const dialogOpen = elements.some((el) => el.tag === 'dialog' && el.visible);

  let interactiveElements = elements.filter((el) => el.visible && el.interactable);

  if (options.mode === 'target-scoped' && options.targetBBox) {
    const [tx, ty, tw, th] = options.targetBBox;
    // Keep elements in proximity (within 150px)
    interactiveElements = interactiveElements.filter((el) => {
      const [ex, ey] = el.bbox;
      return Math.abs(ex - tx) < tw + 150 && Math.abs(ey - ty) < th + 150;
    });
  }

  const interactiveSummary = interactiveElements.map((el) => ({
    tag: el.tag,
    role: el.role,
    name: el.name,
    bbox: roundBBoxToStep(el.bbox, 4),
    disabled: el.aria.disabled,
    checked: el.aria.checked,
  }));

  const payload = {
    origin,
    path,
    frames: frames.map((f) => ({ id: f.frame_id, origin: f.origin })),
    dialogOpen,
    scrollBucket,
    interactive: interactiveSummary,
  };

  const rawJson = canonicalJson(payload);
  const fullHash = await sha256Hex(rawJson);
  return fullHash.slice(0, 16);
}
