// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractDomSnapshot, markDirty } from '../../extension/src/perception/dom/snapshot.js';
import { domElementToPerceptionRegion } from '../../extension/src/perception/dom/to-regions.js';
import { privacyStub, validateAadhaarVerhoeff, validateIndianPAN } from '../../extension/src/privacy.stub.js';
import type { SanitizeRequest } from '../../contracts/ts/privacy.js';

describe('Phase 0: Baseline Freeze — DOM / ARIA and PII Masking Baseline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('1. Records baseline extraction on synthetic page with forms, tables, ARIA, and PII', async () => {
    document.body.innerHTML = `
      <header role="banner">
        <h1>Citizen Service Portal</h1>
      </header>
      <main role="main">
        <form id="kyc-form">
          <label for="full-name">Full Name</label>
          <input type="text" id="full-name" name="name" value="Sanjay Sharma" />

          <label for="user-email">Email Address</label>
          <input type="email" id="user-email" name="email" value="sanjay.sharma@example.gov.in" />

          <label for="user-phone">Mobile Number</label>
          <input type="tel" id="user-phone" name="phone" value="+91 9876543210" />

          <label for="aadhaar">Aadhaar Number</label>
          <input type="text" id="aadhaar" name="aadhaar" value="5489 1234 5674" />

          <label for="pan">PAN Number</label>
          <input type="text" id="pan" name="pan" value="ABCPE1234F" />

          <div role="group" aria-labelledby="addr-label">
            <span id="addr-label">Residential Address</span>
            <textarea id="address">Plot 42, Sector 5, Bengaluru, Karnataka 560001</textarea>
          </div>

          <button type="submit" role="button" aria-label="Submit Verification">Submit KYC</button>
        </form>

        <table role="table" aria-label="Transaction Records">
          <thead>
            <tr><th>Account</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>123456789012</td>
              <td>INR 50,000</td>
              <td>Verified</td>
            </tr>
          </tbody>
        </table>

        <iframe id="sub-frame" src="about:blank" title="Supporting Document Frame"></iframe>
      </main>
    `;

    const snapshot = await extractDomSnapshot('main');
    expect(snapshot.elements.length).toBeGreaterThan(0);

    // Verify key elements captured in baseline snapshot
    const buttonEl = snapshot.elements.find((e) => e.tag === 'button');
    expect(buttonEl).toBeDefined();
    expect(buttonEl?.role).toBe('button');

    const aadhaarInput = snapshot.elements.find((e) => e.dom_id.includes('input') || e.tag === 'input');
    expect(aadhaarInput).toBeDefined();

    // Verify existing privacy engine processing
    const sanitizeReq: SanitizeRequest = {
      cycle_id: 'phase0_baseline_cycle',
      task: {
        task_id: 'task_00',
        task_text: 'Baseline KYC verification',
        allowed_actions: ['click', 'type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_00',
        cycle_id: 'phase0_baseline_cycle',
        page_state_hash: snapshot.page_state_hash,
        origin: snapshot.url_origin,
        regions: snapshot.elements.map((el, i) => {
          const reg = domElementToPerceptionRegion(el, snapshot);
          reg.region_id = `r${i + 1}`;
          return reg;
        }),
        dom: snapshot,
        faces: [], // Frozen: zero face modification
        ocr_tokens: [],
        capture: null,
        ts: Date.now(),
      },
      mode: 'normal',
      include_image: false,
    };

    const result = await privacyStub.sanitize(sanitizeReq);
    expect(result.verdict).toBe('SAFE');
    expect(result.attested?.sha256).toBeDefined();
  });

  it('2. Records baseline Indian PII validation algorithms', () => {
    // Aadhaar Verhoeff
    expect(validateAadhaarVerhoeff('5489 1234 5674')).toBe(true);
    expect(validateAadhaarVerhoeff('1234 5678 9012')).toBe(false);

    // PAN structure
    expect(validateIndianPAN('ABCPE1234F')).toBe(true);
    expect(validateIndianPAN('ABCZE1234F')).toBe(false);
  });

  it('3. Records baseline Shadow DOM perception behavior', async () => {
    const host = document.createElement('div');
    host.id = 'shadow-host';
    document.body.appendChild(host);

    if (host.attachShadow) {
      const shadowRoot = host.attachShadow({ mode: 'open' });
      const shadowBtn = document.createElement('button');
      shadowBtn.textContent = 'Shadow Action';
      shadowRoot.appendChild(shadowBtn);
    }

    const snapshot = await extractDomSnapshot('main');
    expect(snapshot.elements).toBeDefined();
  });

  it('4. Records baseline iframe identification', async () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'test-frame';
    iframe.src = 'about:blank';
    document.body.appendChild(iframe);

    const snapshot = await extractDomSnapshot('main');
    const iframeEl = snapshot.elements.find((e) => e.tag === 'iframe');
    expect(iframeEl).toBeDefined();
  });

  it('5. Records baseline dynamic mutation dirty marking', async () => {
    const container = document.createElement('div');
    container.id = 'dynamic-container';
    document.body.appendChild(container);

    const initialSnap = await extractDomSnapshot('main');
    const initialHash = initialSnap.page_state_hash;

    // Mutate DOM
    const newBtn = document.createElement('button');
    newBtn.textContent = 'Dynamically Added';
    container.appendChild(newBtn);
    markDirty(container);

    const updatedSnap = await extractDomSnapshot('main');
    expect(updatedSnap.elements.some((e) => e.text === 'Dynamically Added')).toBe(true);
  });
});
