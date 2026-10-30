import type { DetectorContext, DetectorValidationResult, PiiDetector } from './types.js';

function contextText(context?: DetectorContext): string {
  const el = context?.element;
  return [context?.surroundingText, context?.formName, el?.name, el?.label,
    el?.description, el?.aria_label, el?.element_name, el?.element_id,
    el?.input?.name, el?.input?.placeholder, el?.input?.autocomplete]
    .filter(Boolean).join(' ').toLowerCase();
}

function result(category: DetectorValidationResult['category'], subtype: string, value: string,
  rule: string, confidence = 0.98): DetectorValidationResult {
  return { isValid: true, category, specificSubtype: subtype, normalizedValue: value,
    confidence, reason: `Validated ${subtype} identifier`,
    evidence: [{ field: 'format_rule', matchedValue: value, matchedRule: rule, signalStrength: 'high' }],
    valueReference: `<REDACTED_${subtype}>`, isMandatory: true };
}

export const usSsnDetector: PiiDetector = {
  id: 'us-ssn-detector', category: 'GOV_ID', specificSubtype: 'US_SSN', priority: 94,
  canHandle: text => /(?<!\d)(?:\d{3}-\d{2}-\d{4}|\d{9})(?!\d)/.test(text),
  detect(text) {
    const match = text.match(/(?<!\d)(?:\d{3}-\d{2}-\d{4}|\d{9})(?!\d)/)?.[0];
    if (!match) return null;
    const digits = match.replace(/\D/g, '');
    if (digits.slice(0, 3) === '000' || digits.slice(0, 3) === '666' || Number(digits.slice(0, 3)) >= 900 ||
        digits.slice(3, 5) === '00' || digits.slice(5) === '0000') return null;
    return result('GOV_ID', 'US_SSN', match, 'us_ssn_structure');
  },
};

export const ukNinDetector: PiiDetector = {
  id: 'uk-nin-detector', category: 'GOV_ID', specificSubtype: 'UK_NIN', priority: 93,
  canHandle: text => /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i.test(text),
  detect(text) {
    const match = text.match(/\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i)?.[0];
    return match ? result('GOV_ID', 'UK_NIN', match, 'uk_nin_structure') : null;
  },
};

export const usEinDetector: PiiDetector = {
  id: 'us-ein-detector', category: 'GOV_ID', specificSubtype: 'US_EIN', priority: 92,
  canHandle: (text, context) => /\b\d{2}-\d{7}\b/.test(text) && /\bein\b|employer identification|tax identification/.test(contextText(context)),
  detect(text, context) {
    const match = text.match(/\b\d{2}-\d{7}\b/)?.[0];
    return match && (/\bein\b|employer identification|tax identification/.test(contextText(context)))
      ? result('GOV_ID', 'US_EIN', match, 'us_ein_with_context') : null;
  },
};

function validIban(value: string): boolean {
  const compact = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const ibanDetector: PiiDetector = {
  id: 'iban-detector', category: 'BANK_ACCOUNT', specificSubtype: 'IBAN', priority: 62,
  canHandle: text => /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/i.test(text),
  detect(text) {
    const match = text.match(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/i)?.[0];
    return match && validIban(match) ? result('BANK_ACCOUNT', 'IBAN', match, 'iban_mod97_valid') : null;
  },
};

export const swiftDetector: PiiDetector = {
  id: 'swift-bic-detector', category: 'IDENTIFIER', specificSubtype: 'SWIFT_BIC', priority: 57,
  canHandle(text, context) { return /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/i.test(text) || /swift|bic code/i.test(contextText(context)); },
  detect(text, context) {
    const match = text.match(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/i)?.[0];
    return match && /swift|bic code/i.test(contextText(context))
      ? result('IDENTIFIER', 'SWIFT_BIC', match, 'swift_bic_structure', 0.94) : null;
  },
};

export const internationalPhoneDetector: PiiDetector = {
  id: 'international-phone-detector', category: 'PHONE', specificSubtype: 'PHONE', priority: 74,
  canHandle: text => /(?<!\w)\+(?!91\b)[1-9](?:[\s().-]*\d){7,14}(?!\d)/.test(text),
  detect(text) {
    const match = text.match(/(?<!\w)\+(?!91\b)[1-9](?:[\s().-]*\d){7,14}(?!\d)/)?.[0];
    if (!match) return null;
    const digits = match.replace(/\D/g, '');
    if (digits.startsWith('91') && digits.length === 12) return null;
    return digits.length >= 8 && digits.length <= 15 ? result('PHONE', 'PHONE', match, 'international_e164_phone', 0.94) : null;
  },
};

export const internationalPassportDetector: PiiDetector = {
  id: 'international-passport-detector', category: 'GOV_ID', specificSubtype: 'PASSPORT', priority: 80,
  canHandle: (text, context) => /passport/.test(contextText(context)) || /\b[A-Z0-9]{6,12}\b/i.test(text),
  detect(text, context) {
    const match = text.match(/\b[A-Z0-9]{6,12}\b/gi)?.find(value =>
      /^\d{6,12}$/.test(value) || (/[A-Z]/i.test(value) && /\d/.test(value)));
    if (!match || !/passport/.test(contextText(context))) return null;
    return result('GOV_ID', 'PASSPORT', match.toUpperCase(), 'international_passport_with_context', 0.90);
  },
};

export const cardSecurityCodeDetector: PiiDetector = {
  id: 'card-security-code-detector', category: 'CARD', specificSubtype: 'CARD_SECURITY_CODE', priority: 54,
  canHandle: (text, context) => /\b(?:cvv|cvc|security code)\b/i.test(contextText(context)) && /\b\d{3,4}\b/.test(text),
  detect(text, context) {
    if (!/\b(?:cvv|cvc|security code)\b/i.test(contextText(context))) return null;
    const match = text.match(/\b\d{3,4}\b/)?.[0];
    return match ? result('CARD', 'CARD_SECURITY_CODE', match, 'card_security_code_with_context', 0.98) : null;
  },
};

export const internationalPiiDetectors: PiiDetector[] = [
  usSsnDetector, usEinDetector, ukNinDetector, ibanDetector, swiftDetector, internationalPhoneDetector,
  internationalPassportDetector, cardSecurityCodeDetector,
];
