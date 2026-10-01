// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import type { DomElementInfo, DomSnapshot } from '../../contracts/ts/dom.js';
import type { SanitizeRequest } from '../../contracts/ts/privacy.js';
import {
  classifyDomElement,
  classifyAllElements,
  isLikelyPiiElement,
} from '../../extension/src/privacy/semantic-pii-classifier.js';
import { privacyStub } from '../../extension/src/privacy.stub.js';

function makeElement(overrides: Partial<DomElementInfo> = {}): DomElementInfo {
  return {
    dom_id: 'elem_1',
    frame_id: 'main',
    origin: 'http://localhost:5173',
    tag: 'input',
    role: 'textbox',
    name: null,
    text: '',
    aria: {},
    bbox: [10, 20, 200, 30],
    visible: true,
    in_viewport: true,
    occluded: false,
    interactable: true,
    rendering: 'html',
    has_bg_image: false,
    handlers_hint: false,
    parent_dom_id: null,
    input: {
      type: 'text',
      autocomplete: null,
      name: null,
      placeholder: null,
      is_password: false,
      has_value: false,
      value: null,
    },
    ...overrides,
  };
}

describe('Phase 3: Semantic PII Classification Layer Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // 1. High-confidence PII semantic context
  it('1. High-confidence PII semantic context generates valid candidates', () => {
    const pwdEl = makeElement({
      dom_id: 'pwd_el',
      label: 'Account Password',
      input: {
        type: 'password',
        autocomplete: 'current-password',
        name: 'password',
        placeholder: 'Enter secure password',
        is_password: true,
        has_value: true,
        value: null,
      },
    });
    const cand = classifyDomElement(pwdEl);

    expect(cand).not.toBeNull();
    expect(cand?.category).toBe('PASSWORD');
    expect(cand?.confidence).toBeGreaterThanOrEqual(0.95);
    expect(cand?.isMandatory).toBe(true);
    expect(cand?.valueReference).toBe('<REDACTED_PASSWORD>');
    expect(isLikelyPiiElement(pwdEl)).toBe(true);
  });

  // 2. Non-PII content
  it('2. Non-PII content is correctly excluded without false alerts', () => {
    const searchEl = makeElement({
      dom_id: 'search_el',
      label: 'Search Knowledgebase',
      name: 'Search Documentation',
      input: {
        type: 'search',
        autocomplete: 'off',
        name: 'query',
        placeholder: 'Search topics, articles, and APIs...',
        is_password: false,
        has_value: false,
        value: null,
      },
    });

    const qtyEl = makeElement({
      dom_id: 'qty_el',
      label: 'Product Quantity',
      name: 'Quantity',
      input: {
        type: 'number',
        autocomplete: null,
        name: 'quantity',
        placeholder: '1-10',
        is_password: false,
        has_value: false,
        value: null,
      },
    });

    const btnEl = makeElement({
      dom_id: 'btn_el',
      tag: 'button',
      role: 'button',
      name: 'Submit Application',
      text: 'Submit Application',
      input: undefined,
    });

    expect(classifyDomElement(searchEl)).toBeNull();
    expect(classifyDomElement(qtyEl)).toBeNull();
    expect(classifyDomElement(btnEl)).toBeNull();
  });

  // 3. Ambiguous content
  it('3. Ambiguous content does not trigger aggressive high-confidence classification', () => {
    const genericCodeEl = makeElement({
      dom_id: 'code_el',
      label: 'Discount Code',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'code',
        placeholder: 'PROMO2026',
        is_password: false,
        has_value: false,
        value: null,
      },
    });

    // Pincode / Postal code should NOT be classified as password PIN
    const pincodeEl = makeElement({
      dom_id: 'pincode_el',
      label: 'Pin Code',
      input: {
        type: 'text',
        autocomplete: 'postal-code',
        name: 'pincode',
        placeholder: '560001',
        is_password: false,
        has_value: false,
        value: null,
      },
    });

    expect(classifyDomElement(genericCodeEl)).toBeNull();
    // pincode should be ADDRESS, not PASSWORD!
    const pinResult = classifyDomElement(pincodeEl);
    expect(pinResult?.category).toBe('ADDRESS');
  });

  // 4. Label-based classification
  it('4. Label-based classification resolves correct PII categories', () => {
    const aadhaarEl = makeElement({
      dom_id: 'aadhaar_el',
      label: 'Resident Aadhaar Number',
    });
    const panEl = makeElement({
      dom_id: 'pan_el',
      label: 'Permanent Account Number (PAN)',
    });
    const dobEl = makeElement({
      dom_id: 'dob_el',
      label: 'Date of Birth',
    });
    const addrEl = makeElement({
      dom_id: 'addr_el',
      label: 'Residential Street Address',
    });

    const candAadhaar = classifyDomElement(aadhaarEl);
    expect(candAadhaar?.category).toBe('GOV_ID');
    expect(candAadhaar?.specificSubtype).toBe('AADHAAR');

    const candPan = classifyDomElement(panEl);
    expect(candPan?.category).toBe('GOV_ID');
    expect(candPan?.specificSubtype).toBe('PAN');

    const candDob = classifyDomElement(dobEl);
    expect(candDob?.category).toBe('DOB');

    const candAddr = classifyDomElement(addrEl);
    expect(candAddr?.category).toBe('ADDRESS');
  });

  // 5. ARIA-name-based classification
  it('5. ARIA-name-based classification extracts candidates from accessible name', () => {
    const cardEl = makeElement({
      dom_id: 'card_el',
      name: 'Credit Card Number',
      aria_label: 'Credit Card Number',
    });
    const pwdEl = makeElement({
      dom_id: 'pwd_el',
      name: 'Confirm Master Password',
    });

    const candCard = classifyDomElement(cardEl);
    expect(candCard?.category).toBe('CARD');
    expect(candCard?.confidence).toBeGreaterThanOrEqual(0.9);

    const candPwd = classifyDomElement(pwdEl);
    expect(candPwd?.category).toBe('PASSWORD');
    expect(candPwd?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  // 6. Placeholder-based classification
  it('6. Placeholder-based classification identifies PII patterns in placeholders', () => {
    const emailEl = makeElement({
      dom_id: 'email_el',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'txt',
        placeholder: 'username@organization.com',
        is_password: false,
        has_value: false,
        value: null,
      },
    });
    const aadhaarMaskEl = makeElement({
      dom_id: 'aadhaar_mask',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'num',
        placeholder: 'xxxx xxxx xxxx (12-digit)',
        is_password: false,
        has_value: false,
        value: null,
      },
    });

    const candEmail = classifyDomElement(emailEl);
    expect(candEmail?.category).toBe('EMAIL');

    const candAadhaar = classifyDomElement(aadhaarMaskEl);
    expect(candAadhaar?.category).toBe('GOV_ID');
    expect(candAadhaar?.specificSubtype).toBe('AADHAAR');
  });

  // 7. Autocomplete-based classification
  it('7. Autocomplete-based classification maps standard W3C autocomplete values', () => {
    const emailEl = makeElement({ input: { type: 'text', autocomplete: 'email', name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const telEl = makeElement({ input: { type: 'text', autocomplete: 'tel', name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const ccEl = makeElement({ input: { type: 'text', autocomplete: 'cc-number', name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const bdayEl = makeElement({ input: { type: 'text', autocomplete: 'bday', name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const streetEl = makeElement({ input: { type: 'text', autocomplete: 'street-address', name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const nameEl = makeElement({ input: { type: 'text', autocomplete: 'name', name: null, placeholder: null, is_password: false, has_value: false, value: null } });

    expect(classifyDomElement(emailEl)?.category).toBe('EMAIL');
    expect(classifyDomElement(telEl)?.category).toBe('PHONE');
    expect(classifyDomElement(ccEl)?.category).toBe('CARD');
    expect(classifyDomElement(bdayEl)?.category).toBe('DOB');
    expect(classifyDomElement(streetEl)?.category).toBe('ADDRESS');
    expect(classifyDomElement(nameEl)?.category).toBe('PERSON');
  });

  // 8. Input-type-based classification
  it('8. Input-type-based classification recognizes native semantic types', () => {
    const emailInput = makeElement({ input: { type: 'email', autocomplete: null, name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const telInput = makeElement({ input: { type: 'tel', autocomplete: null, name: null, placeholder: null, is_password: false, has_value: false, value: null } });
    const pwdInput = makeElement({ input: { type: 'password', autocomplete: null, name: null, placeholder: null, is_password: true, has_value: false, value: null } });

    expect(classifyDomElement(emailInput)?.category).toBe('EMAIL');
    expect(classifyDomElement(telInput)?.category).toBe('PHONE');
    expect(classifyDomElement(pwdInput)?.category).toBe('PASSWORD');
  });

  // 9. Combined semantic signals
  it('9. Combined semantic signals reinforce confidence and aggregate evidence', () => {
    const multiSignalEl = makeElement({
      dom_id: 'corp_email',
      label: 'Corporate Email Address',
      name: 'Email Address',
      input: {
        type: 'email',
        autocomplete: 'email',
        name: 'work_email',
        placeholder: 'employee@corp.com',
        is_password: false,
        has_value: true,
        value: null,
      },
    });

    const cand = classifyDomElement(multiSignalEl);
    expect(cand).not.toBeNull();
    expect(cand?.category).toBe('EMAIL');
    expect(cand?.confidence).toBe(1.0);
    expect(cand?.evidence.length).toBeGreaterThanOrEqual(4);
    expect(cand?.evidence.some((e) => e.field === 'type')).toBe(true);
    expect(cand?.evidence.some((e) => e.field === 'autocomplete')).toBe(true);
    expect(cand?.evidence.some((e) => e.field === 'label')).toBe(true);
    expect(cand?.evidence.some((e) => e.field === 'placeholder')).toBe(true);
  });

  // 10. Duplicate candidate handling
  it('10. Duplicate candidate handling produces deterministic, unified output', () => {
    const elements: DomElementInfo[] = [
      makeElement({
        dom_id: 'd1',
        label: 'Email',
        input: { type: 'email', autocomplete: 'email', name: 'email', placeholder: 'me@host.com', is_password: false, has_value: false, value: null },
      }),
      makeElement({
        dom_id: 'd2',
        label: 'Phone Number',
        input: { type: 'tel', autocomplete: 'tel', name: 'phone', placeholder: '+91 9999999999', is_password: false, has_value: false, value: null },
      }),
    ];

    const candidates = classifyAllElements(elements);
    expect(candidates.length).toBe(2);
    expect(candidates[0]?.id).toBe('pii_email_d1');
    expect(candidates[1]?.id).toBe('pii_phone_d2');
  });

  // 11. Confidence behavior
  it('11. Confidence behavior scales with signal specificity', () => {
    // Single medium signal
    const medEl = makeElement({
      label: 'Pin',
      input: { type: 'text', autocomplete: null, name: 'pin', placeholder: null, is_password: false, has_value: false, value: null },
    });
    // Single high signal
    const highEl = makeElement({
      label: 'Account Password',
      input: { type: 'text', autocomplete: null, name: 'pwd', placeholder: null, is_password: false, has_value: false, value: null },
    });
    // Multiple high signals
    const ultraEl = makeElement({
      label: 'Account Password',
      input: { type: 'password', autocomplete: 'current-password', name: 'pwd', placeholder: 'password', is_password: true, has_value: false, value: null },
    });

    const candMed = classifyDomElement(medEl);
    const candHigh = classifyDomElement(highEl);
    const candUltra = classifyDomElement(ultraEl);

    // Medium signal alone should be below 0.70 threshold or filtered
    expect(candMed === null || candMed.confidence < 0.70).toBe(true);
    expect(candHigh?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(candUltra?.confidence).toBe(1.0);
  });

  // 12. Integration with the existing redaction boundary
  it('12. Integration with the existing redaction boundary correctly sanitizes regions', async () => {
    const emailEl = makeElement({
      dom_id: 'input_email',
      label: 'Personal Email',
      input: { type: 'email', autocomplete: 'email', name: 'email', placeholder: null, is_password: false, has_value: true, value: 'john.doe@test.com' },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_phase3',
      url_origin: 'http://localhost:5173',
      url_path: '/profile',
      frames: [],
      elements: [emailEl],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_test',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_test_p3',
      task: {
        task_id: 't_01',
        task_text: 'profile inspection',
        allowed_actions: ['type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_p3',
        cycle_id: 'c_test_p3',
        page_state_hash: 'hash_test',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_email',
            dom_id: 'input_email',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 20, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: 'john.doe@test.com',
            clean_text: 'john.doe@test.com',
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

    const result = await privacyStub.sanitize(req);
    expect(result.verdict).toBe('SAFE');
    expect(result.detections.length).toBeGreaterThanOrEqual(1);
    expect(result.detections[0]?.type).toBe('EMAIL');
    expect(result.redaction.text_replacements).toBeGreaterThanOrEqual(1);
  });

  // 13. Sanitized observation remains protected
  it('13. Sanitized observation remains protected with cryptographic attestation', async () => {
    const pwdEl = makeElement({
      dom_id: 'input_pwd',
      label: 'Master Secret',
      input: { type: 'password', autocomplete: 'current-password', name: 'pwd', placeholder: null, is_password: true, has_value: true, value: null },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_pwd',
      url_origin: 'http://localhost:5173',
      url_path: '/auth',
      frames: [],
      elements: [pwdEl],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_pwd',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_pwd',
      task: {
        task_id: 't_pwd',
        task_text: 'login',
        allowed_actions: ['type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_pwd',
        cycle_id: 'c_pwd',
        page_state_hash: 'hash_pwd',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_pwd',
            dom_id: 'input_pwd',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 20, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: 'SecretPassword123!',
            clean_text: 'SecretPassword123!',
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

    const result = await privacyStub.sanitize(req);
    expect(result.verdict).toBe('SAFE');
    expect(result.attested?.sha256).toBeDefined();
    // Raw password must NEVER appear in the attested payload
    expect(result.attested?.body.includes('SecretPassword123!')).toBe(false);
  });

  // 14. Existing DOM masking regression
  it('14. Existing DOM masking regression: multi-PII synthetic form sanitization intact', async () => {
    const aadhaarEl = makeElement({
      dom_id: 'in_aadhaar',
      label: 'Aadhaar Card',
      input: { type: 'text', autocomplete: null, name: 'aadhaar', placeholder: 'xxxx xxxx xxxx', is_password: false, has_value: true, value: '5489 1234 5674' },
    });
    const panEl = makeElement({
      dom_id: 'in_pan',
      label: 'PAN Card',
      input: { type: 'text', autocomplete: null, name: 'pan', placeholder: 'ABCDE1234F', is_password: false, has_value: true, value: 'ABCPE1234F' },
    });
    const phoneEl = makeElement({
      dom_id: 'in_phone',
      label: 'Mobile Contact',
      input: { type: 'tel', autocomplete: 'tel', name: 'phone', placeholder: null, is_password: false, has_value: true, value: '+91 9876543210' },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_multi',
      url_origin: 'http://localhost:5173',
      url_path: '/kyc',
      frames: [],
      elements: [aadhaarEl, panEl, phoneEl],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_multi',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_multi',
      task: { task_id: 't_m', task_text: 'kyc', allowed_actions: ['type'], allowed_origins: ['http://localhost:5173'], step_index: 0, history: [] },
      frame: {
        frame_uid: 'f_m',
        cycle_id: 'c_multi',
        page_state_hash: 'hash_multi',
        origin: 'http://localhost:5173',
        regions: [
          { region_id: 'r_a', dom_id: 'in_aadhaar', frame_id: 'main', origin: 'http://localhost:5173', semantic_type: 'input', box_label: 'input', bbox: [10, 20, 200, 30], source_type: 'DOM', sensitive: false, suggested_treatment: 'ALLOW', visual_text: '5489 1234 5674', clean_text: '5489 1234 5674', interactable: true },
          { region_id: 'r_p', dom_id: 'in_pan', frame_id: 'main', origin: 'http://localhost:5173', semantic_type: 'input', box_label: 'input', bbox: [10, 60, 200, 30], source_type: 'DOM', sensitive: false, suggested_treatment: 'ALLOW', visual_text: 'ABCPE1234F', clean_text: 'ABCPE1234F', interactable: true },
          { region_id: 'r_t', dom_id: 'in_phone', frame_id: 'main', origin: 'http://localhost:5173', semantic_type: 'input', box_label: 'input', bbox: [10, 100, 200, 30], source_type: 'DOM', sensitive: false, suggested_treatment: 'ALLOW', visual_text: '+91 9876543210', clean_text: '+91 9876543210', interactable: true },
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
    expect(res.redaction.text_replacements).toBeGreaterThanOrEqual(3);
    expect(res.detections.some((d) => d.type === 'GOV_ID')).toBe(true);
    expect(res.detections.some((d) => d.type === 'PHONE')).toBe(true);
  });

  // 15. Existing face-masking regression
  it('15. Existing face-masking regression: face detections are handled identically and untouched', async () => {
    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_face',
      url_origin: 'http://localhost:5173',
      url_path: '/feed',
      frames: [],
      elements: [],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_face',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_face',
      task: { task_id: 't_f', task_text: 'feed', allowed_actions: ['type'], allowed_origins: ['http://localhost:5173'], step_index: 0, history: [] },
      frame: {
        frame_uid: 'f_f',
        cycle_id: 'c_face',
        page_state_hash: 'hash_face',
        origin: 'http://localhost:5173',
        regions: [],
        dom: mockSnapshot,
        faces: [
          {
            face_id: 'face_01',
            bbox: [100, 100, 80, 80],
            confidence: 0.95,
            landmarks: [],
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
    // Face detection must be detected and masked
    expect(res.detections.some((d) => d.type === 'FACE')).toBe(true);
    const faceDet = res.detections.find((d) => d.type === 'FACE');
    expect(faceDet?.confidence).toBe(0.95);
    expect(faceDet?.mandatory).toBe(true);
  });
});
