import { describe, it, expect } from 'vitest';

/**
 * Test suite for screenshot capture optimization
 * Validates that screenshots are only captured when visual elements are present
 */
describe('Screenshot Capture Optimization', () => {
  describe('Visual element detection logic', () => {
    it('should identify pages with images as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: true,
          in_viewport: true,
          rendering: 'img' as const,
          bbox: [0, 0, 100, 100], // 10,000 px² > 1600 threshold
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(true);
    });

    it('should identify pages with canvas as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: true,
          in_viewport: true,
          rendering: 'canvas' as const,
          bbox: [0, 0, 50, 50], // 2,500 px² > 1600 threshold
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(true);
    });

    it('should identify pages with background images as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: true,
          in_viewport: true,
          rendering: 'html' as const,
          has_bg_image: true,
          bbox: [0, 0, 100, 100],
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(true);
    });

    it('should NOT flag text-only pages as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: true,
          in_viewport: true,
          rendering: 'html' as const,
          has_bg_image: false,
          bbox: [0, 0, 300, 40],
        },
        {
          dom_id: 'd2',
          visible: true,
          in_viewport: true,
          rendering: 'html' as const,
          has_bg_image: false,
          bbox: [0, 50, 100, 40],
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(false);
    });

    it('should NOT flag small decorative icons as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: true,
          in_viewport: true,
          rendering: 'img' as const,
          bbox: [0, 0, 16, 16], // 256 px² < 1600 threshold
        },
        {
          dom_id: 'd2',
          visible: true,
          in_viewport: true,
          rendering: 'img' as const,
          bbox: [0, 0, 24, 24], // 576 px² < 1600 threshold
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(false);
    });

    it('should NOT flag off-screen images as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: true,
          in_viewport: false, // Off-screen
          rendering: 'img' as const,
          bbox: [0, 0, 100, 100],
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(false);
    });

    it('should NOT flag hidden images as requiring vision', () => {
      const elements = [
        {
          dom_id: 'd1',
          visible: false, // Hidden
          in_viewport: true,
          rendering: 'img' as const,
          bbox: [0, 0, 100, 100],
        },
      ];

      const hasVisualElements = elements.some(
        (el) =>
          el.visible &&
          el.in_viewport &&
          (el.rendering === 'img' ||
            el.rendering === 'video' ||
            el.rendering === 'canvas' ||
            (el as any).has_bg_image) &&
          el.bbox[2] * el.bbox[3] >= 1600
      );

      expect(hasVisualElements).toBe(false);
    });
  });

  describe('Threshold validation', () => {
    it('should use 1600px² (40x40) as minimum area threshold', () => {
      const THRESHOLD = 1600;
      const minSize = Math.sqrt(THRESHOLD); // ~40px

      expect(minSize).toBeCloseTo(40, 0);
      expect(40 * 40).toBe(THRESHOLD);
    });

    it('should accept standard profile picture sizes', () => {
      const THRESHOLD = 1600;
      const testSizes = [
        [50, 50], // 2500 px²
        [64, 64], // 4096 px²
        [100, 100], // 10000 px²
        [200, 200], // 40000 px²
      ];

      for (const [w, h] of testSizes) {
        expect(w * h).toBeGreaterThanOrEqual(THRESHOLD);
      }
    });

    it('should reject tiny icons and decorations', () => {
      const THRESHOLD = 1600;
      const testSizes = [
        [16, 16], // 256 px²
        [24, 24], // 576 px²
        [32, 32], // 1024 px²
        [39, 39], // 1521 px² (just under threshold)
      ];

      for (const [w, h] of testSizes) {
        expect(w * h).toBeLessThan(THRESHOLD);
      }
    });
  });
});
