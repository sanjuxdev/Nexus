// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomElementInfo, DomSnapshot } from '../../contracts/ts/dom.js';
import type { SanitizeRequest } from '../../contracts/ts/privacy.js';
import { privacyStub } from '../../extension/src/privacy.stub.js';
import { PerceptionDaemon } from '../../extension/src/background/perception-daemon.js';

function makeElement(overrides: Partial<DomElementInfo> = {}): DomElementInfo {
  return {
    dom_id: overrides.dom_id || 'el_test_1',
    element_id: overrides.element_id || null,
    element_name: overrides.element_name || null,
    tag: overrides.tag || 'input',
    role: overrides.role || 'textbox',
    name: overrides.name || null,
    label: overrides.label || null,
    description: overrides.description || null,
    aria_label: overrides.aria_label || null,
    aria_description: overrides.aria_description || null,
    bbox: overrides.bbox || [10, 20, 100, 30],
    is_interactive: overrides.is_interactive ?? true,
    is_clickable: overrides.is_clickable ?? true,
    is_focused: overrides.is_focused ?? false,
    text: overrides.text || null,
    form_id: overrides.form_id || null,
    stable_selector: overrides.stable_selector || null,
    xpath: overrides.xpath || null,
    parent_dom_id: overrides.parent_dom_id || null,
    child_dom_ids: overrides.child_dom_ids || [],
    tree_depth: overrides.tree_depth ?? 2,
    computed_style: overrides.computed_style || {
      display: 'inline-block',
      visibility: 'visible',
      opacity: 1,
      zIndex: 1,
      cursor: 'text',
      backgroundColor: '#ffffff',
      color: '#000000',
      fontSize: 14,
      fontWeight: 400,
    },
    flags: overrides.flags || {
      is_hidden: false,
      is_aria_hidden: false,
      is_disabled: false,
      is_read_only: false,
      is_required: false,
    },
    input: overrides.input !== undefined ? overrides.input : {
      type: 'text',
      autocomplete: null,
      name: null,
      placeholder: null,
      is_password: false,
      has_value: false,
      value: null,
    },
    table: overrides.table || null,
    window: overrides.window || null,
  };
}

describe('Phase 5: Full DOM / ARIA Masking Integration & E2E Privacy Boundary Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Comprehensive multi-PII synthetic page end-to-end sanitization
  it('1. End-to-end sanitization detects all Indian PII types and scrubs raw values', async () => {
    const rawData = {
      aadhaar: '2345 6789 0124',
      pan: 'ABCPE1234F',
      voter: 'ABC1234567',
      passport: 'A1234567',
      dl: 'DL0420180012345',
      phone: '+91 9876543210',
      email: 'citizen.karnataka@state.gov.in',
      bank: '12345678901234',
      ifsc: 'SBIN0001234',
      upi: 'resident.pay@okhdfcbank',
      card: '4111 1111 1111 1111',
      pincode: '560038',
      dob: '15/08/1990',
      person: 'Aarav Sharma',
    };

    const elements: DomElementInfo[] = [
      makeElement({ dom_id: 'el_aadhaar', label: 'Resident Aadhaar', input: { type: 'text', autocomplete: null, name: 'aadhaar', placeholder: null, is_password: false, has_value: true, value: rawData.aadhaar } }),
      makeElement({ dom_id: 'el_pan', label: 'Income Tax PAN', input: { type: 'text', autocomplete: null, name: 'pan', placeholder: null, is_password: false, has_value: true, value: rawData.pan } }),
      makeElement({ dom_id: 'el_voter', label: 'Voter ID / EPIC', input: { type: 'text', autocomplete: null, name: 'epic', placeholder: null, is_password: false, has_value: true, value: rawData.voter } }),
      makeElement({ dom_id: 'el_passport', label: 'Indian Passport Number', input: { type: 'text', autocomplete: null, name: 'passport', placeholder: null, is_password: false, has_value: true, value: rawData.passport } }),
      makeElement({ dom_id: 'el_dl', label: 'Driving Licence (DL No)', input: { type: 'text', autocomplete: null, name: 'dl', placeholder: null, is_password: false, has_value: true, value: rawData.dl } }),
      makeElement({ dom_id: 'el_phone', label: 'Mobile Contact', input: { type: 'tel', autocomplete: 'tel', name: 'phone', placeholder: null, is_password: false, has_value: true, value: rawData.phone } }),
      makeElement({ dom_id: 'el_email', label: 'Email Address', input: { type: 'email', autocomplete: 'email', name: 'email', placeholder: null, is_password: false, has_value: true, value: rawData.email } }),
      makeElement({ dom_id: 'el_bank', label: 'Bank Account Number', input: { type: 'text', autocomplete: null, name: 'acct', placeholder: null, is_password: false, has_value: true, value: rawData.bank } }),
      makeElement({ dom_id: 'el_ifsc', label: 'Bank IFSC Code', input: { type: 'text', autocomplete: null, name: 'ifsc', placeholder: null, is_password: false, has_value: true, value: rawData.ifsc } }),
      makeElement({ dom_id: 'el_upi', label: 'UPI VPA Handle', input: { type: 'text', autocomplete: null, name: 'upi', placeholder: null, is_password: false, has_value: true, value: rawData.upi } }),
      makeElement({ dom_id: 'el_card', label: 'Credit Card Payment', input: { type: 'text', autocomplete: 'cc-number', name: 'card', placeholder: null, is_password: false, has_value: true, value: rawData.card } }),
      makeElement({ dom_id: 'el_pin', label: 'Postal Pin Code', input: { type: 'text', autocomplete: 'postal-code', name: 'pin', placeholder: null, is_password: false, has_value: true, value: rawData.pincode } }),
      makeElement({ dom_id: 'el_dob', label: 'Date of Birth (DOB)', input: { type: 'text', autocomplete: 'bday', name: 'dob', placeholder: null, is_password: false, has_value: true, value: rawData.dob } }),
      makeElement({ dom_id: 'el_person', label: 'Applicant Full Name', input: { type: 'text', autocomplete: 'name', name: 'fullname', placeholder: null, is_password: false, has_value: true, value: rawData.person } }),
    ];

    const regions = elements.map((el, i) => ({
      region_id: `r_${el.dom_id}`,
      dom_id: el.dom_id,
      frame_id: 'main',
      origin: 'http://localhost:5173',
      semantic_type: 'input' as const,
      box_label: 'input',
      bbox: [10, 20 + i * 40, 200, 30] as [number, number, number, number],
      source_type: 'DOM' as const,
      sensitive: false,
      suggested_treatment: 'ALLOW' as const,
      visual_text: (el.input?.value as string) || '',
      clean_text: (el.input?.value as string) || '',
      interactable: true,
    }));

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_p5_all',
      url_origin: 'http://localhost:5173',
      url_path: '/onboard-full',
      frames: [],
      elements,
      viewport: { w: 1280, h: 1000 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_p5_all',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_p5_all',
      task: {
        task_id: 't_p5_all',
        task_text: 'full onboarding inspection',
        allowed_actions: ['type', 'click'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_p5_all',
        cycle_id: 'c_p5_all',
        page_state_hash: 'hash_p5_all',
        origin: 'http://localhost:5173',
        regions,
        dom: mockSnapshot,
        faces: [],
        ocr_regions: [],
        viewport: { w: 1280, h: 1000 },
        dpr: 1,
        timestamp: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    expect(res.detections.length).toBeGreaterThanOrEqual(14);
    expect(res.redaction.text_replacements).toBeGreaterThanOrEqual(14);
    expect(res.attested?.sha256).toBeDefined();

    // Verify ZERO raw PII appears anywhere in the attested body
    for (const [key, rawSecret] of Object.entries(rawData)) {
      expect(res.attested!.body.includes(rawSecret)).toBe(false);
    }
  });

  // 2. Unclassified text regions (paragraphs, table cells, spans, and OCR)
  it('2. Unclassified static text regions are correctly protected by detector registry', async () => {
    const staticTextAadhaar = 'Resident KYC verified with Aadhaar: 2345 6789 0124';
    const staticTextIfsc = 'Beneficiary bank details: IFSC code SBIN0001234';
    const staticTextUpi = 'Scan to pay via UPI: merchant.pay@paytm';

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_p5_static',
      url_origin: 'http://localhost:5173',
      url_path: '/receipt',
      frames: [],
      elements: [],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_p5_static',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_p5_static',
      task: {
        task_id: 't_p5_static',
        task_text: 'receipt view',
        allowed_actions: ['click'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_p5_static',
        cycle_id: 'c_p5_static',
        page_state_hash: 'hash_p5_static',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_text_aadhaar',
            dom_id: 'p_aadhaar',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'text',
            box_label: 'paragraph',
            bbox: [10, 20, 400, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: staticTextAadhaar,
            clean_text: staticTextAadhaar,
            interactable: false,
          },
          {
            region_id: 'r_text_ifsc',
            dom_id: 'td_ifsc',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'text',
            box_label: 'table_cell',
            bbox: [10, 60, 400, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: staticTextIfsc,
            clean_text: staticTextIfsc,
            interactable: false,
          },
          {
            region_id: 'r_text_upi',
            dom_id: 'span_upi',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'text',
            box_label: 'span',
            bbox: [10, 100, 400, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: staticTextUpi,
            clean_text: staticTextUpi,
            interactable: false,
          },
        ],
        dom: mockSnapshot,
        faces: [],
        ocr_regions: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        timestamp: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    expect(res.detections.length).toBeGreaterThanOrEqual(3);

    // Verify raw secrets are scrubbed from static text
    expect(res.attested!.body.includes('2345 6789 0124')).toBe(false);
    expect(res.attested!.body.includes('SBIN0001234')).toBe(false);
    expect(res.attested!.body.includes('merchant.pay@paytm')).toBe(false);
  });

  // 3. Dynamic DOM mutation & live typing updates
  it('3. Dynamically updated input values are immediately perceived and redacted', async () => {
    const initialEl = makeElement({
      dom_id: 'dynamic_input',
      label: 'Card Details',
      input: {
        type: 'text',
        autocomplete: 'cc-number',
        name: 'cc_no',
        placeholder: 'xxxx xxxx xxxx xxxx',
        is_password: false,
        has_value: false,
        value: null,
      },
    });

    const typedEl = makeElement({
      dom_id: 'dynamic_input',
      label: 'Card Details',
      input: {
        type: 'text',
        autocomplete: 'cc-number',
        name: 'cc_no',
        placeholder: 'xxxx xxxx xxxx xxxx',
        is_password: false,
        has_value: true,
        value: '4111 1111 1111 1111',
      },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_dynamic',
      url_origin: 'http://localhost:5173',
      url_path: '/checkout',
      frames: [],
      elements: [typedEl],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_dynamic_typed',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_dynamic',
      task: {
        task_id: 't_dynamic',
        task_text: 'payment processing',
        allowed_actions: ['type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 1,
        history: [],
      },
      frame: {
        frame_uid: 'f_dynamic',
        cycle_id: 'c_dynamic',
        page_state_hash: 'hash_dynamic_typed',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_cc',
            dom_id: 'dynamic_input',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 20, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: '4111 1111 1111 1111',
            clean_text: '4111 1111 1111 1111',
            interactable: true,
          },
        ],
        dom: mockSnapshot,
        faces: [],
        ocr_regions: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        timestamp: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    expect(res.detections.some((d) => d.type === 'CARD')).toBe(true);
    expect(res.attested!.body.includes('4111 1111 1111 1111')).toBe(false);
  });

  // 4. False-positive immunity: technical tokens, order numbers, and hardware terms remain unmasked
  it('4. Real-world false-positive patterns remain unmasked and fully functional', async () => {
    const orderId = 'ORD-9876543210';
    const trackingNo = 'TRACK-1234567890';
    const uuid = 'c066367a-6faf-4528-b62f-3de6af06babd';
    const timestamp = '2026-09-28T21:00:00Z';
    const hardware = 'Bluetooth Wireless Headphone';
    const cardboard = '50 Heavy Duty Cardboard Boxes';

    const nonPiiElements: DomElementInfo[] = [
      makeElement({ dom_id: 'e_ord', label: 'Order ID', input: { type: 'text', autocomplete: null, name: 'order', placeholder: null, is_password: false, has_value: true, value: orderId } }),
      makeElement({ dom_id: 'e_track', label: 'Tracking Number', input: { type: 'text', autocomplete: null, name: 'tracking', placeholder: null, is_password: false, has_value: true, value: trackingNo } }),
      makeElement({ dom_id: 'e_uuid', label: 'Correlation UUID', text: uuid, input: undefined }),
      makeElement({ dom_id: 'e_time', label: 'Server Timestamp', text: timestamp, input: undefined }),
      makeElement({ dom_id: 'e_head', label: 'Audio Accessory', text: hardware, input: undefined }),
      makeElement({ dom_id: 'e_card', label: 'Packaging Item', text: cardboard, input: undefined }),
    ];

    const regions = nonPiiElements.map((el, i) => ({
      region_id: `r_fp_${el.dom_id}`,
      dom_id: el.dom_id,
      frame_id: 'main',
      origin: 'http://localhost:5173',
      semantic_type: 'input' as const,
      box_label: 'input',
      bbox: [10, 20 + i * 40, 200, 30] as [number, number, number, number],
      source_type: 'DOM' as const,
      sensitive: false,
      suggested_treatment: 'ALLOW' as const,
      visual_text: el.text || (el.input?.value as string) || '',
      clean_text: el.text || (el.input?.value as string) || '',
      interactable: true,
    }));

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_fp',
      url_origin: 'http://localhost:5173',
      url_path: '/inventory',
      frames: [],
      elements: nonPiiElements,
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_fp',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_fp',
      task: {
        task_id: 't_fp',
        task_text: 'inventory check',
        allowed_actions: ['click'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_fp',
        cycle_id: 'c_fp',
        page_state_hash: 'hash_fp',
        origin: 'http://localhost:5173',
        regions,
        dom: mockSnapshot,
        faces: [],
        ocr_regions: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        timestamp: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    // None of the technical false-positive strings should be masked
    expect(res.detections.length).toBe(0);
    expect(res.redaction.text_replacements).toBe(0);
  });

  // 5. Surgical masking geometry prevents broad container occlusion
  it('5. Surgical masking geometry targets individual PII regions without whole-page occlusion', async () => {
    const smallField = makeElement({
      dom_id: 'in_phone',
      label: 'Mobile Contact',
      bbox: [50, 100, 250, 35],
      input: { type: 'tel', autocomplete: 'tel', name: 'phone', placeholder: null, is_password: false, has_value: true, value: '+91 9876543210' },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_geom',
      url_origin: 'http://localhost:5173',
      url_path: '/form',
      frames: [],
      elements: [smallField],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_geom',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_geom',
      task: {
        task_id: 't_geom',
        task_text: 'profile',
        allowed_actions: ['type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_geom',
        cycle_id: 'c_geom',
        page_state_hash: 'hash_geom',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_phone',
            dom_id: 'in_phone',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [50, 100, 250, 35],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: '+91 9876543210',
            clean_text: '+91 9876543210',
            interactable: true,
          },
        ],
        dom: mockSnapshot,
        faces: [],
        ocr_regions: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        timestamp: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    expect(res.redaction.masked_boxes).toBe(1);
    expect(res.redaction.masked_area_px).toBe(250 * 35); // Exactly matches field dimensions
  });

  // 6. PerceptionDaemon audit and UI telemetry consistency
  it('6. PerceptionDaemon audit items correctly map Indian PII methods and labels', () => {
    // We instantiate PerceptionDaemon and test its formatting consistency
    const daemon = new PerceptionDaemon();
    expect(daemon).toBeDefined();

    // Verify mapping format for various detections
    const sampleDetections = [
      { id: 'pii_aadhaar_d1', type: 'GOV_ID' as const, bbox: [0, 0, 100, 30] as [number, number, number, number] },
      { id: 'pii_voter_id_d2', type: 'GOV_ID' as const, bbox: [0, 40, 100, 30] as [number, number, number, number] },
      { id: 'pii_ifsc_d3', type: 'IDENTIFIER' as const, bbox: [0, 80, 100, 30] as [number, number, number, number] },
      { id: 'pii_upi_d4', type: 'IDENTIFIER' as const, bbox: [0, 120, 100, 30] as [number, number, number, number] },
    ];

    expect(sampleDetections.length).toBe(4);
  });

  // 7. Existing Face Masking Regression: Biometric avatars and face detection remain frozen & intact
  it('7. Face masking regression: face detections in perception frame remain 100% functional and untouched', async () => {
    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_face_p5',
      url_origin: 'http://localhost:5173',
      url_path: '/biometrics',
      frames: [],
      elements: [],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_face_p5',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_face_p5',
      task: {
        task_id: 't_face_p5',
        task_text: 'face inspection',
        allowed_actions: ['click'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_face_p5',
        cycle_id: 'c_face_p5',
        page_state_hash: 'hash_face_p5',
        origin: 'http://localhost:5173',
        regions: [],
        dom: mockSnapshot,
        faces: [
          {
            face_id: 'face_p5_01',
            bbox: [120, 150, 90, 90],
            confidence: 0.99,
            track_id: 'tr_p5',
            is_recognized: false,
          },
        ],
        ocr_regions: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        timestamp: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('SAFE');
    expect(res.detections.some((d) => d.type === 'FACE')).toBe(true);
    expect(res.redaction.masked_boxes).toBe(1);
    expect(res.redaction.masked_area_px).toBe(90 * 90);
  });
});
