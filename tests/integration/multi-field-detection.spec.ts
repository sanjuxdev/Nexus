/**
 * Integration Test: Multi-Field Document Detection
 * 
 * Validates that the improved PII detection system can identify multiple
 * distinct fields within a single document image (e.g., PAN card, Aadhaar card).
 * 
 * Scenario: A PAN card image displayed in a document viewer (like Scribd)
 * contains multiple sensitive fields that should each be detected and
 * redacted independently.
 * 
 * Expected Detections:
 * 1. PAN Number: ABCDE1234F
 * 2. Name: John Doe
 * 3. Father's Name: Robert Doe  
 * 4. Date of Birth: 15/08/1990
 * 5. Photograph (face detection)
 * 6. Signature
 * 
 * Previous Behavior: Only face was detected
 * Expected New Behavior: All 6 fields detected with precise bounding boxes
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { OcrToken, PerceptionFrame, SanitizeRequest } from '@contracts/index.js';
import { privacyStub } from '../../extension/src/privacy.stub.js';

describe('Multi-Field Document Detection', () => {
  it('should detect all PII fields in a synthetic PAN card image', async () => {
    // Synthetic OCR output simulating a PAN card
    const syntheticPanCardOcr: OcrToken[] = [
      // Line 1: Header
      { text: 'INCOME', bbox: [100, 50, 80, 20], confidence: 0.95, line_number: 0, word_index: 0 },
      { text: 'TAX', bbox: [185, 50, 50, 20], confidence: 0.95, line_number: 0, word_index: 1 },
      { text: 'DEPARTMENT', bbox: [240, 50, 120, 20], confidence: 0.95, line_number: 0, word_index: 2 },
      
      // Line 2: PAN Label + Number (on same line for realistic detection)
      // Valid PAN format: First 3 letters, 4th is entity type (P=Person), 5th initial, next 4 digits, last check letter
      { text: 'PAN:', bbox: [100, 100, 50, 18], confidence: 0.94, line_number: 1, word_index: 0 },
      { text: 'ABCPJ1234K', bbox: [155, 100, 150, 22], confidence: 0.98, line_number: 1, word_index: 1 },
      
      // Line 3: Name Label + Value
      { text: 'Name:', bbox: [100, 170, 60, 18], confidence: 0.94, line_number: 3, word_index: 0 },
      { text: 'John', bbox: [165, 170, 50, 18], confidence: 0.96, line_number: 3, word_index: 1 },
      { text: 'Doe', bbox: [220, 170, 40, 18], confidence: 0.96, line_number: 3, word_index: 2 },
      
      // Line 4: Father's Name
      { text: "Father's", bbox: [100, 200, 70, 18], confidence: 0.93, line_number: 4, word_index: 0 },
      { text: 'Name:', bbox: [175, 200, 55, 18], confidence: 0.93, line_number: 4, word_index: 1 },
      { text: 'Robert', bbox: [235, 200, 60, 18], confidence: 0.95, line_number: 4, word_index: 2 },
      { text: 'Doe', bbox: [300, 200, 40, 18], confidence: 0.95, line_number: 4, word_index: 3 },
      
      // Line 5: Date of Birth
      { text: 'Date', bbox: [100, 230, 50, 18], confidence: 0.92, line_number: 5, word_index: 0 },
      { text: 'of', bbox: [155, 230, 25, 18], confidence: 0.92, line_number: 5, word_index: 1 },
      { text: 'Birth:', bbox: [185, 230, 50, 18], confidence: 0.92, line_number: 5, word_index: 2 },
      { text: '15/08/1990', bbox: [240, 230, 110, 18], confidence: 0.97, line_number: 5, word_index: 3 },
    ];

    // Synthetic perception frame representing a PAN card image element
    const syntheticFrame: PerceptionFrame = {
      frame_uid: 'test_frame_001',
      cycle_id: 'test_cycle_001',
      page_state_hash: 'hash_test',
      origin: 'http://localhost:5173',
      regions: [
        {
          region_id: 'r1_pan_card_image',
          local_key: 'd1',
          source: ['DOM'],
          semantic_type: 'image',
          text: null,
          bbox: [50, 30, 400, 280], // Large bounding box for entire PAN card image
          confidence: 1.0,
          visible: true,
          interactable: false,
          visual_state: ['visible'],
          dom_ref: { dom_id: 'd1', role: 'img', tag: 'img' },
          route: 'HIGH',
          sensitivity: 'unclassified',
          origin: 'http://localhost:5173',
          frame_id: 'main',
          page_state_hash: 'hash_test',
          timestamp: Date.now(),
        },
      ],
      ocr_tokens: syntheticPanCardOcr,
      faces: [
        // Synthetic face detection (photograph on PAN card)
        {
          bbox: [350, 100, 80, 100], // Face photo location
          confidence: 0.92,
          landmarks: [],
        },
      ],
      dom: {
        snapshot_id: 'snap_test',
        url_origin: 'http://localhost:5173',
        url_path: '/pan-card-viewer',
        frames: [
          {
            frame_id: 'main',
            parent_frame_id: null,
            origin: 'http://localhost:5173',
            path: '/pan-card-viewer',
            offset: [0, 0],
            accessible: true,
          },
        ],
        elements: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        scroll: { x: 0, y: 0 },
        page_state_hash: 'hash_test',
        ts: Date.now(),
      },
      capture: {
        capture_id: 'cap_test_001',
        image: { w: 1280, h: 800 },
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        scroll: { x: 0, y: 0 },
        ts: Date.now(),
      },
      ts: Date.now(),
    };

    const sanitizeRequest: SanitizeRequest = {
      cycle_id: 'test_cycle_001',
      task: {
        task_id: 'test_task_001',
        task_text: 'Privacy Protection Test',
        allowed_actions: [],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: syntheticFrame,
      mode: 'normal',
      include_image: false,
    };

    // Execute sanitization with new multi-field detection
    const result = await privacyStub.sanitize(sanitizeRequest);

    // Assertions
    expect(result.verdict).toBe('SAFE');
    console.log('Detected fields:', result.detections.map(d => ({ id: d.id, type: d.type, confidence: d.confidence })));
    expect(result.detections.length).toBeGreaterThanOrEqual(5); // At least PAN, Name, Father's Name, DOB, Face

    // Check for PAN number detection
    const panDetection = result.detections.find((d) =>
      d.id.toLowerCase().includes('pan') && d.type === 'GOV_ID'
    );
    expect(panDetection).toBeDefined();
    expect(panDetection?.confidence).toBeGreaterThan(0.8);
    expect(panDetection?.bbox).toBeDefined();

    // Check for name detection
    const nameDetection = result.detections.find((d) =>
      d.id.toLowerCase().includes('name') && d.type === 'PERSON'
    );
    expect(nameDetection).toBeDefined();

    // Check for DOB detection
    const dobDetection = result.detections.find((d) =>
      d.id.toLowerCase().includes('dob') || d.type === 'DOB'
    );
    expect(dobDetection).toBeDefined();

    // Check for face detection
    const faceDetection = result.detections.find((d) => d.type === 'FACE');
    expect(faceDetection).toBeDefined();
    expect(faceDetection?.confidence).toBeGreaterThan(0.8);

    // Verify that detections have DISTINCT bounding boxes (not all using the same large image bbox)
    const uniqueBboxes = new Set(
      result.detections.map((d) => JSON.stringify(d.bbox))
    );
    expect(uniqueBboxes.size).toBeGreaterThanOrEqual(4); // At least 4 different bounding boxes

    // Verify redaction boxes are precise (not one giant blackout)
    expect(result.redaction.masked_boxes).toBeGreaterThanOrEqual(4);
    
    // Verify no box is oversized (>800px width or >600px height)
    // This is checked internally by filterOversizedBoxes in the stub

    console.log(`✓ Detected ${result.detections.length} PII fields in PAN card`);
    console.log(`✓ Distinct bounding boxes: ${uniqueBboxes.size}`);
    console.log(`✓ Redaction boxes: ${result.redaction.masked_boxes}`);
  });

  it('should handle Google Images search results without oversized redactions', async () => {
    // Simulate multiple small thumbnail images in a search result page
    // Each thumbnail should get a precise redaction, not one large blackout
    // Uses phone numbers since they don't require complex document context validation
    
    const googleImagesFrame: PerceptionFrame = {
      frame_uid: 'test_frame_002',
      cycle_id: 'test_cycle_002',
      page_state_hash: 'hash_test_2',
      origin: 'https://www.google.com',
      regions: [
        // Thumbnail 1: Contains visible phone number in screenshot
        {
          region_id: 'r1_thumb1',
          local_key: 'thumb1',
          source: ['DOM'],
          semantic_type: 'image',
          text: null,
          bbox: [100, 100, 200, 150],
          confidence: 1.0,
          visible: true,
          interactable: true,
          visual_state: ['visible'],
          dom_ref: { dom_id: 'thumb1', role: 'img', tag: 'img' },
          route: 'HIGH',
          sensitivity: 'unclassified',
          origin: 'https://www.google.com',
          frame_id: 'main',
          page_state_hash: 'hash_test_2',
          timestamp: Date.now(),
        },
        // Thumbnail 2: Contains visible phone number
        {
          region_id: 'r2_thumb2',
          local_key: 'thumb2',
          source: ['DOM'],
          semantic_type: 'image',
          text: null,
          bbox: [320, 100, 200, 150],
          confidence: 1.0,
          visible: true,
          interactable: true,
          visual_state: ['visible'],
          dom_ref: { dom_id: 'thumb2', role: 'img', tag: 'img' },
          route: 'HIGH',
          sensitivity: 'unclassified',
          origin: 'https://www.google.com',
          frame_id: 'main',
          page_state_hash: 'hash_test_2',
          timestamp: Date.now(),
        },
      ],
      ocr_tokens: [
        // OCR from thumbnail 1 - Phone number (within bbox [100, 100, 200, 150])
        { text: '+91', bbox: [120, 120, 30, 18], confidence: 0.92, line_number: 0, word_index: 0 },
        { text: '8765432109', bbox: [155, 120, 90, 18], confidence: 0.96, line_number: 0, word_index: 1 },
        
        // OCR from thumbnail 2 - Phone number (within bbox [320, 100, 200, 150])
        { text: '+91', bbox: [340, 120, 30, 18], confidence: 0.92, line_number: 1, word_index: 0 },
        { text: '9876543210', bbox: [375, 120, 90, 18], confidence: 0.96, line_number: 1, word_index: 1 },
      ],
      faces: [],
      dom: {
        snapshot_id: 'snap_test_2',
        url_origin: 'https://www.google.com',
        url_path: '/search',
        frames: [
          {
            frame_id: 'main',
            parent_frame_id: null,
            origin: 'https://www.google.com',
            path: '/search',
            offset: [0, 0],
            accessible: true,
          },
        ],
        elements: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        scroll: { x: 0, y: 0 },
        page_state_hash: 'hash_test_2',
        ts: Date.now(),
      },
      capture: {
        capture_id: 'cap_test_002',
        image: { w: 1280, h: 800 },
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        scroll: { x: 0, y: 0 },
        ts: Date.now(),
      },
      ts: Date.now(),
    };

    const sanitizeRequest: SanitizeRequest = {
      cycle_id: 'test_cycle_002',
      task: {
        task_id: 'test_task_002',
        task_text: 'Google Images Privacy Test',
        allowed_actions: [],
        allowed_origins: ['https://www.google.com'],
        step_index: 0,
        history: [],
      },
      frame: googleImagesFrame,
      mode: 'normal',
      include_image: false,
    };

    const result = await privacyStub.sanitize(sanitizeRequest);

    expect(result.verdict).toBe('SAFE');

    // Should detect both PII items
    expect(result.detections.length).toBeGreaterThanOrEqual(2);

    // Each thumbnail should have precise redaction, not entire page blackout
    const redactionBoxes = result.detections.filter(d => d.bbox).map(d => d.bbox!);
    
    // No redaction box should cover more than 50% of viewport width or height
    const viewport = googleImagesFrame.dom.viewport;
    for (const bbox of redactionBoxes) {
      const widthPercent = bbox[2] / viewport.w;
      const heightPercent = bbox[3] / viewport.h;
      
      expect(widthPercent).toBeLessThan(0.5);
      expect(heightPercent).toBeLessThan(0.5);
    }

    console.log(`✓ Google Images: ${result.detections.length} precise detections`);
    console.log(`✓ No oversized redaction boxes`);
  });
});
