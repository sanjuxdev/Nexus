import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DomSnapshotSchema,
  SanitizedContextSchema,
  PlanResponseSchema,
  toRect,
  toImagePx,
  toCssPx,
  padBBox,
  intersectBBox,
  bus,
  stageError,
} from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures');

describe('Contracts & Schemas validation', () => {
  it('validates sanitized_context.valid.json', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'wire/sanitized_context.valid.json'), 'utf8');
    const data = JSON.parse(raw);
    const parsed = SanitizedContextSchema.parse(data);
    expect(parsed.request_id).toBe('req_demo_01');
    expect(parsed.regions.length).toBe(3);
  });

  it('rejects sanitized_context.invalid_extra_field.json with extra fields', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'wire/sanitized_context.invalid_extra_field.json'), 'utf8');
    const data = JSON.parse(raw);
    expect(() => SanitizedContextSchema.parse(data)).toThrow();
  });

  it('validates plan_response.valid.json', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'wire/plan_response.valid.json'), 'utf8');
    const data = JSON.parse(raw);
    const parsed = PlanResponseSchema.parse(data);
    expect(parsed.action?.action).toBe('click');
    expect(parsed.action?.target?.region_id).toBe('r3');
  });

  it('rejects plan_response.invalid_action.json with disallowed action', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'wire/plan_response.invalid_action.json'), 'utf8');
    const data = JSON.parse(raw);
    expect(() => PlanResponseSchema.parse(data)).toThrow();
  });

  it('validates dom.json from login-demo frame fixture', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'frames/login-demo/dom.json'), 'utf8');
    const data = JSON.parse(raw);
    const parsed = DomSnapshotSchema.parse(data);
    expect(parsed.elements.length).toBe(3);
    expect(parsed.page_state_hash).toBe('a1b2c3d4e5f60718');
  });
});

describe('Geometry utilities', () => {
  it('converts BBox to Rect', () => {
    const rect = toRect([10, 20, 100, 50]);
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('scales BBox for DPR', () => {
    const bbox: [number, number, number, number] = [10, 20, 100, 50];
    const imagePx = toImagePx(bbox, 2);
    expect(imagePx).toEqual([20, 40, 200, 100]);
    const cssPx = toCssPx(imagePx, 2);
    expect(cssPx).toEqual([10, 20, 100, 50]);
  });

  it('pads BBox safely with boundary constraints', () => {
    const bbox: [number, number, number, number] = [10, 10, 50, 50];
    const padded = padBBox(bbox, 5, { w: 100, h: 100 });
    expect(padded).toEqual([5, 5, 60, 60]);
  });

  it('computes BBox intersection', () => {
    const a: [number, number, number, number] = [0, 0, 50, 50];
    const b: [number, number, number, number] = [25, 25, 50, 50];
    const inter = intersectBBox(a, b);
    expect(inter).toEqual([25, 25, 25, 25]);
  });
});

describe('Bus fallback and envelope', () => {
  it('registers and delivers messages across in-memory bus', async () => {
    const unbind = bus.on('privacy/start', async (payload) => {
      expect(payload.tab_id).toBe(123);
      return { task_id: 'task_123' };
    });

    const res = await bus.send('privacy/start', { tab_id: 123 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.task_id).toBe('task_123');
    }

    unbind();
  });

  it('returns error envelope if no handler registered', async () => {
    bus._clearLocalHandlers();
    const res = await bus.send('privacy/stop', { task_id: '123' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('INTERNAL');
    }
  });
});
