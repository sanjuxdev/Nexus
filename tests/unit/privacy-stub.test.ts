import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  privacyStub,
  validateAadhaarVerhoeff,
  validateIndianPAN,
} from '../../extension/src/privacy.stub.js';
import { SanitizedContextSchema, AttestedPayloadSchema } from '../../contracts/ts/schemas.js';
import type { SanitizeRequest } from '../../contracts/ts/privacy.js';

describe('privacyStub Unit Tests', () => {
  describe('Indian PII Validators (Aadhaar Verhoeff & PAN)', () => {
    it('validates 12-digit Aadhaar with Verhoeff dihedral D5 checksum', () => {
      // 5489 1234 5674 has valid Verhoeff checksum and starts with 5
      expect(validateAadhaarVerhoeff('5489 1234 5674')).toBe(true);
      expect(validateAadhaarVerhoeff('5489-1234-5674')).toBe(true);
      expect(validateAadhaarVerhoeff('548912345674')).toBe(true);

      // Invalid checksum
      expect(validateAadhaarVerhoeff('5489 1234 5678')).toBe(false);
      expect(validateAadhaarVerhoeff('1234 5678 9012')).toBe(false);

      // Invalid format / starting with 0 or 1 per UIDAI
      expect(validateAadhaarVerhoeff('0123 4567 8901')).toBe(false);
      expect(validateAadhaarVerhoeff('1123 4567 8901')).toBe(false);
      expect(validateAadhaarVerhoeff('12345')).toBe(false);
    });

    it('validates Indian PAN format with 4th-character entity code', () => {
      // P = Individual
      expect(validateIndianPAN('ABCPE1234F')).toBe(true);
      // C = Company
      expect(validateIndianPAN('XYZCA9876K')).toBe(true);
      // G = Government
      expect(validateIndianPAN('DELGA1111Z')).toBe(true);

      // Invalid entity code (e.g. 'Z')
      expect(validateIndianPAN('ABCZE1234F')).toBe(false);
      // Invalid structure
      expect(validateIndianPAN('12345ABCDE')).toBe(false);
      expect(validateIndianPAN('ABCPE12345')).toBe(false);
    });
  });

  const baseRequest: SanitizeRequest = {
    cycle_id: 'cycle_test_01',
    task: {
      task_id: 'task_01',
      task_text: 'Log into the portal using demo credentials',
      allowed_actions: ['click', 'type', 'fill_secret'],
      allowed_origins: ['http://localhost:5173'],
      step_index: 0,
      history: [],
    },
    frame: {
      frame_uid: 'frame_uid_01',
      cycle_id: 'cycle_test_01',
      page_state_hash: 'abc123hash',
      origin: 'http://localhost:5173',
      regions: [
        {
          region_id: 'r1',
          local_key: 'd1',
          source: ['DOM'],
          semantic_type: 'input',
          text: 'user@example.com',
          bbox: [10, 20, 200, 30],
          confidence: 1.0,
          visible: true,
          interactable: true,
          dom_ref: { dom_id: 'd1', role: 'textbox', tag: 'input' },
          route: 'HIGH',
          sensitivity: 'pii',
          origin: 'http://localhost:5173',
          frame_id: 'main',
          page_state_hash: 'abc123hash',
          timestamp: Date.now(),
        },
        {
          region_id: 'r2',
          local_key: 'd2',
          source: ['DOM'],
          semantic_type: 'input',
          text: '5489 1234 5674', // Valid Aadhaar
          bbox: [10, 60, 200, 30],
          confidence: 1.0,
          visible: true,
          interactable: true,
          dom_ref: { dom_id: 'd2', role: 'textbox', tag: 'input' },
          route: 'HIGH',
          sensitivity: 'pii',
          origin: 'http://localhost:5173',
          frame_id: 'main',
          page_state_hash: 'abc123hash',
          timestamp: Date.now(),
        },
        {
          region_id: 'r3',
          local_key: 'd3',
          source: ['DOM'],
          semantic_type: 'input',
          text: 'ABCPE1234F', // Valid PAN
          bbox: [10, 100, 200, 30],
          confidence: 1.0,
          visible: true,
          interactable: true,
          dom_ref: { dom_id: 'd3', role: 'textbox', tag: 'input' },
          route: 'HIGH',
          sensitivity: 'pii',
          origin: 'http://localhost:5173',
          frame_id: 'main',
          page_state_hash: 'abc123hash',
          timestamp: Date.now(),
        },
        {
          region_id: 'r4',
          local_key: 'd4',
          source: ['DOM'],
          semantic_type: 'button',
          text: 'Submit Form',
          bbox: [10, 140, 100, 40],
          confidence: 1.0,
          visible: true,
          interactable: true,
          dom_ref: { dom_id: 'd4', role: 'button', tag: 'button' },
          route: 'HIGH',
          sensitivity: 'none',
          origin: 'http://localhost:5173',
          frame_id: 'main',
          page_state_hash: 'abc123hash',
          timestamp: Date.now(),
        },
      ],
      ocr_tokens: [],
      faces: [],
      dom: {
        snapshot_id: 'snap_01',
        url_origin: 'http://localhost:5173',
        url_path: '/login',
        frames: [
          {
            frame_id: 'main',
            parent_frame_id: null,
            origin: 'http://localhost:5173',
            path: '/login',
            offset: [0, 0],
            accessible: true,
          },
        ],
        elements: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        scroll: { x: 0, y: 0 },
        page_state_hash: 'abc123hash',
        ts: Date.now(),
      },
      capture: null,
      ts: Date.now(),
    },
    mode: 'normal',
    include_image: false,
  };

  it('blocks non-localhost origins', async () => {
    const req: SanitizeRequest = {
      ...baseRequest,
      frame: {
        ...baseRequest.frame,
        origin: 'https://external-site.com',
      },
    };

    const res = await privacyStub.sanitize(req);
    expect(res.verdict).toBe('BLOCK');
    expect(res.attested).toBeNull();
    expect(res.block?.checks_failed).toContain('stub_env_restricted');
  });

  it('sanitizes Email, Aadhaar, and PAN, returning valid AttestedPayload and SanitizedContext', async () => {
    const res = await privacyStub.sanitize(baseRequest);
    expect(res.verdict).toBe('SAFE');
    expect(res.attested).not.toBeNull();
    expect(res.detections.length).toBe(3); // Email, Aadhaar, PAN

    // Validate with Zod schemas
    if (res.attested) {
      const parsedAttested = AttestedPayloadSchema.safeParse(res.attested);
      expect(parsedAttested.success).toBe(true);

      const parsedContextObj = JSON.parse(res.attested.body);
      const parsedContext = SanitizedContextSchema.safeParse(parsedContextObj);
      expect(parsedContext.success).toBe(true);

      // Verify email redaction placeholder
      const r1 = parsedContextObj.regions.find((r: any) => r.region_id === 'r1');
      expect(r1.text).toBe('<EMAIL>');

      // Verify Aadhaar redaction placeholder
      const r2 = parsedContextObj.regions.find((r: any) => r.region_id === 'r2');
      expect(r2.text).toBe('<REDACTED_AADHAAR>');

      // Verify PAN redaction placeholder
      const r3 = parsedContextObj.regions.find((r: any) => r.region_id === 'r3');
      expect(r3.text).toBe('<REDACTED_PAN>');
    }
  });

  it('scans outbound text correctly for placeholders, emails, Aadhaar, and PAN', async () => {
    const safeResult = await privacyStub.scanOutboundText('Hello world');
    expect(safeResult.safe).toBe(true);
    expect(safeResult.findings.length).toBe(0);

    const emailResult = await privacyStub.scanOutboundText('Contact me at admin@test.com today');
    expect(emailResult.safe).toBe(false);
    expect(emailResult.findings[0]?.type).toBe('EMAIL');

    const aadhaarResult = await privacyStub.scanOutboundText('My Aadhaar is 5489 1234 5674');
    expect(aadhaarResult.safe).toBe(false);
    expect(aadhaarResult.findings[0]?.type).toBe('GOV_ID');

    const panResult = await privacyStub.scanOutboundText('My PAN is ABCPE1234F');
    expect(panResult.safe).toBe(false);
    expect(panResult.findings[0]?.type).toBe('GOV_ID');

    const tokenResult = await privacyStub.scanOutboundText('Fill <REDACTED_AADHAAR> into input');
    expect(tokenResult.safe).toBe(false);
    expect(tokenResult.findings[0]?.type).toBe('IDENTIFIER');
  });

  it('manages vault authorization and resolution correctly', async () => {
    const authOk = await privacyStub.vault.authorize('cap_pwd_01', {
      task_id: 'task_01',
      origin: 'http://localhost:5173',
      frame_id: 'main',
      action: 'fill_secret',
    });
    expect(authOk.ok).toBe(true);

    const authDeniedOrigin = await privacyStub.vault.authorize('cap_pwd_01', {
      task_id: 'task_01',
      origin: 'http://evil.com',
      frame_id: 'main',
      action: 'fill_secret',
    });
    expect(authDeniedOrigin.ok).toBe(false);

    const secret = await privacyStub.vault.resolve('cap_pwd_01', {
      task_id: 'task_01',
      origin: 'http://localhost:5173',
    });
    expect(secret).toBe('SuperSecret123!');
  });
});
