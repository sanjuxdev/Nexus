import type { BBox } from './common.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function toRect(bbox: BBox): Rect {
  return {
    x: bbox[0],
    y: bbox[1],
    width: bbox[2],
    height: bbox[3],
  };
}

export function fromRect(rect: { x: number; y: number; width: number; height: number } | DOMRect | DOMRectReadOnly): BBox {
  return [rect.x, rect.y, rect.width, rect.height];
}

export function toImagePx(bbox: BBox, dpr: number): BBox {
  return [
    Math.round(bbox[0] * dpr),
    Math.round(bbox[1] * dpr),
    Math.round(bbox[2] * dpr),
    Math.round(bbox[3] * dpr),
  ];
}

export function toCssPx(bbox: BBox, dpr: number): BBox {
  const scale = dpr > 0 ? 1 / dpr : 1;
  return [
    bbox[0] * scale,
    bbox[1] * scale,
    bbox[2] * scale,
    bbox[3] * scale,
  ];
}

export function padBBox(bbox: BBox, padding: number, maxBounds?: { w: number; h: number }): BBox {
  const x = Math.max(0, bbox[0] - padding);
  const y = Math.max(0, bbox[1] - padding);
  let w = bbox[2] + padding * 2;
  let h = bbox[3] + padding * 2;

  if (maxBounds) {
    w = Math.min(w, maxBounds.w - x);
    h = Math.min(h, maxBounds.h - y);
  }

  return [x, y, Math.max(0, w), Math.max(0, h)];
}

export function roundBBox(bbox: BBox, precision = 0): BBox {
  const factor = 10 ** precision;
  return [
    Math.round(bbox[0] * factor) / factor,
    Math.round(bbox[1] * factor) / factor,
    Math.round(bbox[2] * factor) / factor,
    Math.round(bbox[3] * factor) / factor,
  ];
}

export function roundBBoxToStep(bbox: BBox, step = 4): BBox {
  return [
    Math.round(bbox[0] / step) * step,
    Math.round(bbox[1] / step) * step,
    Math.round(bbox[2] / step) * step,
    Math.round(bbox[3] / step) * step,
  ];
}

export function centerPoint(bbox: BBox): [number, number] {
  return [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2];
}

export function containsPoint(bbox: BBox, x: number, y: number): boolean {
  return (
    x >= bbox[0] &&
    x <= bbox[0] + bbox[2] &&
    y >= bbox[1] &&
    y <= bbox[1] + bbox[3]
  );
}

export function intersectBBox(a: BBox, b: BBox): BBox | null {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);

  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2 - x1, y2 - y1];
}

export function translateBBox(bbox: BBox, dx: number, dy: number): BBox {
  return [bbox[0] + dx, bbox[1] + dy, bbox[2], bbox[3]];
}

export function bboxArea(bbox: BBox): number {
  return Math.max(0, bbox[2]) * Math.max(0, bbox[3]);
}
