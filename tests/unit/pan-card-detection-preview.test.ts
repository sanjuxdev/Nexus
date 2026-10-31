import { describe, it, expect } from 'vitest';
import { privacyStub } from '../../extension/src/privacy.stub.js';
import type { PerceptionFrame, SanitizeRequest } from '../../contracts/ts/index.js';

describe('PAN Card PII Detection & Surgical Masking', () => {
  it('surgically masks PAN card fields without blacking out the full image', async () => {
    // 1x1 transparent PNG data url as dummy image
    const dummyImage =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const frame: PerceptionFrame = {
      frame_uid: 'f_pan_card_test',
      cycle_id: 'c_pan_1',
      page_state_hash: 'hash_pan',
      origin: 'https://demo.local',
      ts: Date.now(),
      dom: {
        url_origin: 'https://demo.local',
        url_path: '/pan-card.html',
        title: 'PAN Card Viewer',
        page_state_hash: 'hash_pan',
        viewport: { w: 1280, h: 800 },
        elements: [
          {
            dom_id: 'el_pan_img',
            tag: 'img',
            role: 'img',
            name: 'PAN Card Scan',
            text: '',
            classes: ['id-card'],
            bbox: [100, 100, 480, 300], // Full card image: 480x300
            visible: true,
            interactable: false,
            in_viewport: true,
            occluded: false,
            rendering: 'img',
            has_bg_image: false,
            handlers_hint: false,
            parent_dom_id: null,
            aria: {},
            frame_id: 'main',
            origin: 'https://demo.local',
          },
        ],
        frames: [],
        ts: Date.now(),
      },
      regions: [
        {
          region_id: 'r_pan_image',
          local_key: 'el_pan_img',
          dom_ref: { dom_id: 'el_pan_img', tag: 'img', role: 'img' },
          source: ['DOM', 'VISION'],
          semantic_type: 'image',
          text: 'INCOME TAX DEPARTMENT GOVT. OF INDIA AIVPU0924A UPPULA VARUN KUMAR',
          bbox: [100, 100, 480, 300],
          confidence: 0.95,
          visible: true,
          interactable: false,
          visual_state: ['visible', 'enabled'],
          route: 'MEDIUM',
          sensitivity: 'unclassified',
          origin: 'https://demo.local',
          frame_id: 'main',
          page_state_hash: 'hash_pan',
          timestamp: Date.now(),
        },
      ],
      ocr_tokens: [
        { text: 'INCOME', bbox: [120, 110, 50, 15], confidence: 0.95, line_id: 0 },
        { text: 'TAX', bbox: [175, 110, 30, 15], confidence: 0.95, line_id: 0 },
        { text: 'DEPARTMENT', bbox: [210, 110, 90, 15], confidence: 0.95, line_id: 0 },
        { text: 'Name', bbox: [120, 140, 40, 14], confidence: 0.92, line_id: 1 },
        { text: 'UPPULA', bbox: [120, 160, 60, 16], confidence: 0.94, line_id: 2 },
        { text: 'VARUN', bbox: [185, 160, 50, 16], confidence: 0.94, line_id: 2 },
        { text: 'KUMAR', bbox: [240, 160, 55, 16], confidence: 0.94, line_id: 2 },
        { text: "Father's", bbox: [120, 190, 60, 14], confidence: 0.91, line_id: 3 },
        { text: 'Name', bbox: [185, 190, 40, 14], confidence: 0.91, line_id: 3 },
        { text: 'UPPULA', bbox: [120, 210, 60, 16], confidence: 0.93, line_id: 4 },
        { text: 'VENKATESHWARLU', bbox: [185, 210, 120, 16], confidence: 0.93, line_id: 4 },
        { text: 'DOB:', bbox: [120, 240, 35, 14], confidence: 0.90, line_id: 5 },
        { text: '28/05/1998', bbox: [160, 240, 80, 14], confidence: 0.95, line_id: 5 },
        { text: 'Permanent', bbox: [120, 270, 75, 14], confidence: 0.92, line_id: 6 },
        { text: 'Account', bbox: [200, 270, 60, 14], confidence: 0.92, line_id: 6 },
        { text: 'Number', bbox: [265, 270, 55, 14], confidence: 0.92, line_id: 6 },
        { text: 'AIVPU0924A', bbox: [120, 290, 110, 18], confidence: 0.99, line_id: 7 },
      ],
      faces: [
        {
          bbox: [420, 140, 120, 140],
          confidence: 0.98,
          coordinateSpace: 'frame',
        },
      ],
      capture: {
        capture_id: 'cap_pan_1',
        page_state_hash: 'hash_pan',
        dpr: 1,
        viewport: { w: 1280, h: 800 },
        scroll: { x: 0, y: 0 },
        image: { w: 1280, h: 800 },
        ts: Date.now(),
      },
    };

    const req: SanitizeRequest = {
      task: {
        task_id: 't_pan_1',
        step_index: 0,
        task_text: 'Inspect PAN card',
        history: [],
      },
      cycle_id: 'c_pan_1',
      frame,
      image_data_url: dummyImage,
      mode: 'normal',
    };

    const res = await privacyStub.sanitize(req);

    // 1. Sanitization succeeds
    expect(res.verdict).toBe('SAFE');

    // 2. Full image (480x300 at [100, 100]) is NOT in redaction boxes!
    // Surgical boxes are applied to PAN, Name, Father Name, DOB, and Face.
    const detectedFieldTypes = res.detections.map((d) => d.type);
    expect(detectedFieldTypes).toContain('GOV_ID'); // PAN
    expect(detectedFieldTypes).toContain('PERSON'); // Name / Father Name
    expect(detectedFieldTypes).toContain('DOB'); // DOB
    expect(detectedFieldTypes).toContain('FACE'); // Face

    // Verify sanitized preview is generated
    expect(res.masked_data_url).toBeTruthy();
    expect(res.redaction.masked_boxes).toBeGreaterThan(0);

    // Verify NO redaction box covers the entire 480x300 image
    expect(res.redaction.masked_area_px).toBeLessThan(480 * 300);
  });

  it('form input fields for PAN and passwords maintain their direct input masking', async () => {
    const frame: PerceptionFrame = {
      frame_uid: 'f_form_test',
      cycle_id: 'c_form_1',
      page_state_hash: 'hash_form',
      origin: 'https://demo.local',
      ts: Date.now(),
      dom: {
        url_origin: 'https://demo.local',
        url_path: '/login.html',
        title: 'Login Form',
        page_state_hash: 'hash_form',
        viewport: { w: 1280, h: 800 },
        elements: [
          {
            dom_id: 'inp_pan',
            tag: 'input',
            role: 'textbox',
            name: 'PAN Number',
            text: 'ABCPE1234F',
            classes: ['form-input'],
            bbox: [100, 200, 250, 36],
            visible: true,
            interactable: true,
            in_viewport: true,
            occluded: false,
            rendering: 'html',
            has_bg_image: false,
            handlers_hint: true,
            parent_dom_id: null,
            input: {
              type: 'text',
              name: 'pan',
              value: 'ABCPE1234F',
              placeholder: 'Enter PAN',
              autocomplete: null,
              is_password: false,
              has_value: true,
            },
            aria: {},
            frame_id: 'main',
            origin: 'https://demo.local',
          },
        ],
        frames: [],
        ts: Date.now(),
      },
      regions: [
        {
          region_id: 'r_pan_input',
          local_key: 'inp_pan',
          dom_ref: { dom_id: 'inp_pan', tag: 'input', role: 'textbox' },
          source: ['DOM'],
          semantic_type: 'input',
          text: 'PAN Number: ABCPE1234F',
          bbox: [100, 200, 250, 36],
          confidence: 0.99,
          visible: true,
          interactable: true,
          visual_state: ['visible', 'enabled'],
          route: 'HIGH',
          sensitivity: 'unclassified',
          origin: 'https://demo.local',
          frame_id: 'main',
          page_state_hash: 'hash_form',
          timestamp: Date.now(),
        },
      ],
      capture: null,
    };

    const req: SanitizeRequest = {
      task: {
        task_id: 't_form_1',
        step_index: 0,
        task_text: 'Fill form',
        history: [],
      },
      cycle_id: 'c_form_1',
      frame,
      image_data_url: null,
      mode: 'normal',
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    expect(res.detections.length).toBeGreaterThanOrEqual(1);
    expect(res.detections[0]!.type).toBe('GOV_ID');
    expect(res.detections[0]!.bbox).toEqual([100, 200, 250, 36]);
    expect(res.redaction.masked_boxes).toBe(1);
  });
});
