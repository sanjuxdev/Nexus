import { describe, expect, it } from 'vitest';
import { indianPiiRegistry } from '../../extension/src/privacy/indian-pii-registry.js';

describe('expanded PII text detection', () => {
  it('detects Indian identity, tax, contact, payment, and bank identifiers', () => {
    const input = 'Aadhaar 2345 6789 0124 PAN ABCPD1234F mobile +91 9876543210 UPI alice@OKSBI card number 4111 1111 1111 1111 IFSC hdfc0001234';
    const candidates = indianPiiRegistry.detectText(input, { surroundingText: input });
    const subtypes = candidates.map(candidate => candidate.specificSubtype);
    expect(subtypes).toEqual(expect.arrayContaining(['AADHAAR', 'PAN', 'PHONE', 'UPI', 'CARD', 'IFSC']));
    for (const candidate of candidates) {
      expect(candidate.confidence).toBeGreaterThanOrEqual(0.7);
      expect(candidate.evidence.some(e => input.includes(e.matchedValue))).toBe(true);
    }
  });

  it('detects international identifiers and financial data', () => {
    const input = 'SSN 123-45-6789, EIN 12-3456789, UK NIN AB 12 34 56 C, passport A1234567, IBAN GB82 WEST 1234 5698 7654 32, SWIFT DEUTDEFF500, phone +1 (415) 555-2671, CVV 123';
    const candidates = indianPiiRegistry.detectText(input, { surroundingText: input });
    expect(candidates.map(candidate => candidate.specificSubtype)).toEqual(expect.arrayContaining([
      'US_SSN', 'US_EIN', 'UK_NIN', 'PASSPORT', 'IBAN', 'SWIFT_BIC', 'PHONE', 'CARD_SECURITY_CODE',
    ]));
  });

  it('returns separate evidence and candidates for repeated occurrences', () => {
    const input = 'Contact a.person@example.org and b.person@example.net; call +1 415 555 2671 or +44 20 7946 0958';
    const candidates = indianPiiRegistry.detectText(input, { surroundingText: input });
    const emails = candidates.filter(candidate => candidate.specificSubtype === 'EMAIL');
    const phones = candidates.filter(candidate => candidate.specificSubtype === 'PHONE');
    expect(emails).toHaveLength(2);
    expect(phones).toHaveLength(2);
    expect(emails.map(candidate => candidate.evidence[0]?.matchedValue)).toEqual(['a.person@example.org', 'b.person@example.net']);
  });

  it('detects OCR-extracted text with a source and bounding box supplied by the image pipeline', () => {
    const bbox: [number, number, number, number] = [18, 42, 192, 24];
    const [candidate] = indianPiiRegistry.detectText('SSN 123-45-6789', {
      sourceType: 'OCR',
      surroundingText: 'SSN',
      element: { bbox } as never,
    });
    expect(candidate?.specificSubtype).toBe('US_SSN');
    expect(candidate?.bbox).toEqual(bbox);
    expect(candidate?.confidence).toBeGreaterThan(0.7);
  });

  it('rejects malformed, partially masked, and non-PII lookalikes', () => {
    for (const input of [
      'SSN 000-12-3456', 'SSN 123-00-6789', 'SSN XXX-XX-6789',
      'order 123-45-6789', 'call 555-1234', 'FACEBOOK',
      'IBAN GB00 WEST 1234 5698 7654 32', 'cardboard wildcard postcard',
    ]) {
      expect(indianPiiRegistry.detectText(input, { surroundingText: input }), input).toEqual([]);
    }
  });
});
