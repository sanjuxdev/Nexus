// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomElementInfo, DomSnapshot } from '../../contracts/ts/dom.js';
import type { SanitizeRequest } from '../../contracts/ts/privacy.js';
import {
  indianPiiRegistry,
  IndianPiiRegistry,
} from '../../extension/src/privacy/indian-pii-registry.js';
import {
  aadhaarDetector,
  panDetector,
  voterIdDetector,
  passportDetector,
  drivingLicenceDetector,
  validateAadhaarVerhoeff,
  validateIndianPAN,
  validateVoterId,
  validateIndianPassport,
  validateDrivingLicence,
} from '../../extension/src/privacy/detectors/identity.js';
import {
  indianPhoneDetector,
  emailDetector,
  addressDetector,
} from '../../extension/src/privacy/detectors/contact.js';
import {
  bankAccountDetector,
  ifscDetector,
  upiDetector,
  cardDetector,
  validateLuhn,
  validateIFSC,
  validateUpiId,
} from '../../extension/src/privacy/detectors/financial.js';
import {
  personNameDetector,
  dateOfBirthDetector,
} from '../../extension/src/privacy/detectors/personal.js';
import {
  classifyDomElement,
  classifyAllElements,
} from '../../extension/src/privacy/semantic-pii-classifier.js';
import { privacyStub } from '../../extension/src/privacy.stub.js';

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

describe('Phase 4: Indian PII Detector Registry Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Aadhaar candidate
  it('1. Aadhaar candidate: synthetic 12-digit number passing Verhoeff with context produces valid candidate', () => {
    const validSyntheticAadhaar = '2345 6789 0124';
    expect(validateAadhaarVerhoeff(validSyntheticAadhaar)).toBe(true);

    const el = makeElement({
      dom_id: 'aadhaar_field',
      label: 'Resident Aadhaar Number',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'aadhaar',
        placeholder: 'xxxx xxxx xxxx',
        is_password: false,
        has_value: true,
        value: validSyntheticAadhaar,
      },
    });

    const res = classifyDomElement(el);
    expect(res).not.toBeNull();
    expect(res?.category).toBe('GOV_ID');
    expect(res?.specificSubtype).toBe('AADHAAR');
    expect(res?.confidence).toBe(1.0);
    expect(res?.isMandatory).toBe(true);
    expect(res?.evidence.some((e) => e.matchedRule === 'verhoeff_d5_valid')).toBe(true);
  });

  // 2. Aadhaar false positive
  it('2. Aadhaar false positive: rejects numbers with invalid Verhoeff checksum or order/tracking context', () => {
    // Fails Verhoeff checksum
    const invalidVerhoeff = '2345 6789 0128';
    expect(validateAadhaarVerhoeff(invalidVerhoeff)).toBe(false);

    const badChecksumEl = makeElement({
      label: 'Aadhaar Card',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'aadhaar',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: invalidVerhoeff,
      },
    });
    // Valid Verhoeff checksum but in order number context
    const orderNumberEl = makeElement({
      label: 'Order Number',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'order_id',
        placeholder: '123456789012',
        is_password: false,
        has_value: true,
        value: '234567890124',
      },
    });

    // Bare 12-digit number with no Aadhaar context
    const bareNumEl = makeElement({
      label: 'Quantity or Code',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'item_code',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: '234567890124',
      },
    });

    expect(classifyDomElement(badChecksumEl)).not.toBeNull(); // Should only match as empty input if hasAadhaarContext, but value shouldn't be validated as checksum
    expect(classifyDomElement(badChecksumEl)?.evidence.some((e) => e.matchedRule === 'verhoeff_d5_valid')).toBe(false);
    expect(classifyDomElement(orderNumberEl)).toBeNull();
    expect(classifyDomElement(bareNumEl)).toBeNull();
  });

  // 3. PAN candidate
  it('3. PAN candidate: valid synthetic Indian PAN with recognized entity code produces valid candidate', () => {
    const validSyntheticPAN = 'ABCPE1234F'; // 4th char 'P' indicates Individual
    expect(validateIndianPAN(validSyntheticPAN)).toBe(true);

    const el = makeElement({
      dom_id: 'pan_field',
      label: 'Permanent Account Number (PAN)',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'pan_no',
        placeholder: 'ABCDE1234F',
        is_password: false,
        has_value: true,
        value: validSyntheticPAN,
      },
    });

    const res = classifyDomElement(el);
    expect(res).not.toBeNull();
    expect(res?.category).toBe('GOV_ID');
    expect(res?.specificSubtype).toBe('PAN');
    expect(res?.confidence).toBe(1.0);
    expect(res?.evidence.some((e) => e.matchedRule.includes('pan_entity_type_P'))).toBe(true);
  });

  // 4. PAN false positive
  it('4. PAN false positive: rejects invalid entity codes and non-tax terms (panoramic, pantry)', () => {
    const invalidEntityPAN = 'ABCDE1234F'; // 'D' is NOT a valid PAN entity type
    expect(validateIndianPAN(invalidEntityPAN)).toBe(false);

    const badEntityEl = makeElement({
      label: 'PAN Card',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'pan',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: invalidEntityPAN,
      },
    });

    const panoramicEl = makeElement({
      label: 'Panoramic Camera View Option',
      text: 'Panoramic photo panel',
      input: undefined,
    });

    const pantryEl = makeElement({
      label: 'Pantry Supplies List',
      text: 'Order pantry coffee',
      input: undefined,
    });

    expect(classifyDomElement(badEntityEl)?.evidence.some((e) => e.matchedRule.includes('pan_entity_type'))).toBe(false);
    expect(classifyDomElement(panoramicEl)).toBeNull();
    expect(classifyDomElement(pantryEl)).toBeNull();
  });

  // 5. Indian phone candidate
  it('5. Indian phone candidate: detects standard mobile formats with +91, 0, or 10-digit 6-9 prefixes', () => {
    const el1 = makeElement({
      label: 'Mobile Contact Number',
      input: {
        type: 'tel',
        autocomplete: 'tel',
        name: 'mobile',
        placeholder: '+91 9876543210',
        is_password: false,
        has_value: true,
        value: '+91 98765 43210',
      },
    });
    const el2 = makeElement({
      label: 'WhatsApp Number',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'wa_phone',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: '09876543210',
      },
    });

    const res1 = classifyDomElement(el1);
    const res2 = classifyDomElement(el2);

    expect(res1?.category).toBe('PHONE');
    expect(res1?.confidence).toBeGreaterThanOrEqual(0.95);
    expect(res2?.category).toBe('PHONE');
    expect(res2?.confidence).toBeGreaterThanOrEqual(0.95);
  });

  // 6. Phone false positive
  it('6. Phone false positive: audio hardware words (headphone, microphone) and bare 10-digit orders excluded', () => {
    const headphoneEl = makeElement({
      label: 'Headphone Volume Slider',
      text: 'Wireless Bluetooth Headphone',
      input: undefined,
    });
    const micEl = makeElement({
      label: 'Microphone Sensitivity',
      text: 'USB Microphone Settings',
      input: undefined,
    });
    const orderNumberEl = makeElement({
      label: 'Order Reference ID',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'order_id',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: '9876543210', // 10 digits in order context
      },
    });

    expect(classifyDomElement(headphoneEl)).toBeNull();
    expect(classifyDomElement(micEl)).toBeNull();
    expect(classifyDomElement(orderNumberEl)).toBeNull();
  });

  // 7. Email candidate
  it('7. Email candidate: detects standard email addresses with RFC structure and semantic signals', () => {
    const emailEl = makeElement({
      label: 'Personal Email Address',
      input: {
        type: 'email',
        autocomplete: 'email',
        name: 'user_email',
        placeholder: 'resident@karnataka.gov.in',
        is_password: false,
        has_value: true,
        value: 'citizen.karnataka@state.gov.in',
      },
    });

    const res = classifyDomElement(emailEl);
    expect(res?.category).toBe('EMAIL');
    expect(res?.confidence).toBe(1.0);
    expect(res?.evidence.some((e) => e.matchedRule === 'rfc5322_email_pattern')).toBe(true);
  });

  // 8. Email false positive
  it('8. Email false positive: excludes voicemail, mailman, and text containing at signs without email structure', () => {
    const voicemailEl = makeElement({
      label: 'Voicemail Inbox',
      text: 'Listen to voicemail recording',
      input: undefined,
    });
    const atSignTextEl = makeElement({
      label: 'Meeting Schedule',
      text: 'Team sync @ 4pm in room B',
      input: undefined,
    });

    expect(classifyDomElement(voicemailEl)).toBeNull();
    expect(classifyDomElement(atSignTextEl)).toBeNull();
  });

  // 9. Bank account candidate
  it('9. Bank account candidate: detects 9-18 digit numeric strings under bank account context', () => {
    const bankEl = makeElement({
      label: 'Bank Account Number (Savings/Current)',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'bank_account',
        placeholder: 'Enter 9-18 digit account number',
        is_password: false,
        has_value: true,
        value: '12345678901234',
      },
    });

    const res = classifyDomElement(bankEl);
    expect(res?.category).toBe('BANK_ACCOUNT');
    expect(res?.specificSubtype).toBe('BANK_ACCOUNT');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 10. Bank account false positive
  it('10. Bank account false positive: rejects numbers without bank context or user/social account numbers', () => {
    const rawNumberEl = makeElement({
      label: 'Serial Number',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'serial',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: '12345678901234',
      },
    });
    const userAccountEl = makeElement({
      label: 'User Account Profile ID',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'account_id',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: '12345678901234',
      },
    });

    expect(classifyDomElement(rawNumberEl)).toBeNull();
    expect(classifyDomElement(userAccountEl)).toBeNull();
  });

  // 11. IFSC candidate
  it('11. IFSC candidate: validates 11-character Indian financial code with 5th character zero', () => {
    const validIFSC = 'SBIN0001234';
    expect(validateIFSC(validIFSC)).toBe(true);

    const ifscEl = makeElement({
      label: 'Bank Branch IFSC Code',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'ifsc_code',
        placeholder: 'ABCD0123456',
        is_password: false,
        has_value: true,
        value: validIFSC,
      },
    });

    const res = classifyDomElement(ifscEl);
    expect(res?.category).toBe('IDENTIFIER');
    expect(res?.specificSubtype).toBe('IFSC');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.95);
  });

  // 12. IFSC false positive
  it('12. IFSC false positive: rejects 11-char strings where 5th char is not zero or invalid length', () => {
    expect(validateIFSC('SBIN1001234')).toBe(false); // 5th char '1' instead of '0'
    expect(validateIFSC('SBIN001234')).toBe(false);  // 10 chars instead of 11

    const invalidIfscEl = makeElement({
      label: 'IFSC Code',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'ifsc',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: 'SBIN1001234',
      },
    });

    // Shouldn't match with valid format rule
    const res = classifyDomElement(invalidIfscEl);
    expect(res?.evidence.some((e) => e.matchedRule === 'ifsc_4letter_zero_6alphanumeric')).toBe(false);
  });

  // 13. UPI candidate
  it('13. UPI candidate: recognizes VPA handle with common PSP providers and UPI semantic context', () => {
    const validUpi = 'customer.payment@okhdfcbank';
    expect(validateUpiId(validUpi)).toBe(true);

    const upiEl = makeElement({
      label: 'Virtual Payment Address (UPI ID)',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'upi_vpa',
        placeholder: 'username@bank',
        is_password: false,
        has_value: true,
        value: validUpi,
      },
    });

    const res = classifyDomElement(upiEl);
    expect(res?.category).toBe('IDENTIFIER');
    expect(res?.specificSubtype).toBe('UPI');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 14. UPI false positive
  it('14. UPI false positive: rejects email addresses with dot in domain or plain usernames', () => {
    expect(validateUpiId('user@example.com')).toBe(false); // '.com' has a dot
    expect(validateUpiId('plain_username_no_at')).toBe(false);

    const emailNotUpiEl = makeElement({
      label: 'Email Contact',
      input: {
        type: 'email',
        autocomplete: 'email',
        name: 'email',
        placeholder: null,
        is_password: false,
        has_value: true,
        value: 'user@example.com',
      },
    });

    const res = classifyDomElement(emailNotUpiEl);
    expect(res?.specificSubtype).toBe('EMAIL');
    expect(res?.specificSubtype).not.toBe('UPI');
  });

  // 15. Card candidate
  it('15. Card candidate: extracts payment card sequence and validates Luhn Modulus 10 checksum', () => {
    const validCard = '4111 1111 1111 1111'; // Classic Luhn valid Visa test number
    expect(validateLuhn(validCard)).toBe(true);

    const cardEl = makeElement({
      label: 'Credit / Debit Card Number',
      input: {
        type: 'text',
        autocomplete: 'cc-number',
        name: 'card_number',
        placeholder: 'xxxx xxxx xxxx xxxx',
        is_password: false,
        has_value: true,
        value: validCard,
      },
    });

    const res = classifyDomElement(cardEl);
    expect(res?.category).toBe('CARD');
    expect(res?.specificSubtype).toBe('CARD');
    expect(res?.confidence).toBe(1.0);
    expect(res?.evidence.some((e) => e.matchedRule === 'luhn_mod10_valid')).toBe(true);
  });

  // 16. Card false positive
  it('16. Card false positive: rejects numbers failing Luhn and non-payment terms (cardboard, sim card)', () => {
    const invalidCard = '4111 1111 1111 1112'; // Checksum invalid
    expect(validateLuhn(invalidCard)).toBe(false);

    const cardboardEl = makeElement({
      label: 'Cardboard Packaging Quantity',
      text: 'Order 50 cardboard boxes',
      input: undefined,
    });
    const simCardEl = makeElement({
      label: 'SIM Card Slot Indicator',
      text: 'Nano SIM card tray',
      input: undefined,
    });

    expect(classifyDomElement(cardboardEl)).toBeNull();
    expect(classifyDomElement(simCardEl)).toBeNull();
  });

  // 17. Voter ID candidate
  it('17. Voter ID candidate: validates 3 letters + 7 digits Indian EPIC format with voter context', () => {
    const validEpic = 'ABC1234567';
    expect(validateVoterId(validEpic)).toBe(true);

    const epicEl = makeElement({
      label: 'Voter ID / EPIC Number',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'epic_number',
        placeholder: 'ABC1234567',
        is_password: false,
        has_value: true,
        value: validEpic,
      },
    });

    const res = classifyDomElement(epicEl);
    expect(res?.category).toBe('GOV_ID');
    expect(res?.specificSubtype).toBe('VOTER_ID');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 18. Passport candidate
  it('18. Passport candidate: validates 1 letter + 7 digits Indian passport format with passport context', () => {
    const validPassport = 'A1234567';
    expect(validateIndianPassport(validPassport)).toBe(true);

    const passportEl = makeElement({
      label: 'Republic of India Passport Number',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'passport_num',
        placeholder: 'A1234567',
        is_password: false,
        has_value: true,
        value: validPassport,
      },
    });

    const res = classifyDomElement(passportEl);
    expect(res?.category).toBe('GOV_ID');
    expect(res?.specificSubtype).toBe('PASSPORT');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 19. Driving licence candidate
  it('19. Driving licence candidate: validates state code and Sarathi format with year and DL context', () => {
    const validDL = 'DL0420180012345';
    expect(validateDrivingLicence(validDL)).toBe(true);

    const dlEl = makeElement({
      label: 'Driving Licence (DL No)',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'dl_number',
        placeholder: 'DL-0420180012345',
        is_password: false,
        has_value: true,
        value: validDL,
      },
    });

    const res = classifyDomElement(dlEl);
    expect(res?.category).toBe('GOV_ID');
    expect(res?.specificSubtype).toBe('DRIVING_LICENCE');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 20. Address candidate
  it('20. Address candidate: detects residential and street address fields via semantic cues', () => {
    const addrEl = makeElement({
      label: 'Residential Street Address',
      input: {
        type: 'text',
        autocomplete: 'street-address',
        name: 'address_line1',
        placeholder: 'Flat / Door / House No, Street',
        is_password: false,
        has_value: true,
        value: '42 MG Road, Indiranagar',
      },
    });

    const res = classifyDomElement(addrEl);
    expect(res?.category).toBe('ADDRESS');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 21. PIN code with address context
  it('21. PIN code with address context: classifies 6 digits starting with 1-9 as ADDRESS when corroborated', () => {
    const pinEl = makeElement({
      label: 'Postal Pin Code',
      input: {
        type: 'text',
        autocomplete: 'postal-code',
        name: 'pincode',
        placeholder: '560001',
        is_password: false,
        has_value: true,
        value: '560038',
      },
    });

    const res = classifyDomElement(pinEl);
    expect(res?.category).toBe('ADDRESS');
    expect(res?.specificSubtype).toBe('PINCODE');
    expect(res?.confidence).toBeGreaterThanOrEqual(0.90);
  });

  // 22. PIN code without context
  it('22. PIN code without context: rejects arbitrary 6-digit numbers in unrelated or non-address fields', () => {
    const quantityEl = makeElement({
      label: 'Batch Production Quantity',
      input: {
        type: 'number',
        autocomplete: null,
        name: 'qty',
        placeholder: '0',
        is_password: false,
        has_value: true,
        value: '560038',
      },
    });

    expect(classifyDomElement(quantityEl)).toBeNull();
  });

  // 23. Person-name semantic detection
  it('23. Person-name semantic detection: recognizes explicit name fields while excluding file/product names', () => {
    const personNameEl = makeElement({
      label: 'Applicant Full Name',
      input: {
        type: 'text',
        autocomplete: 'name',
        name: 'full_name',
        placeholder: 'First and Last name',
        is_password: false,
        has_value: true,
        value: 'Aarav Sharma',
      },
    });

    const fileNameEl = makeElement({
      label: 'Document File Name',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'filename',
        placeholder: 'report.pdf',
        is_password: false,
        has_value: true,
        value: 'report.pdf',
      },
    });

    const personRes = classifyDomElement(personNameEl);
    expect(personRes?.category).toBe('PERSON');
    expect(personRes?.confidence).toBeGreaterThanOrEqual(0.90);

    expect(classifyDomElement(fileNameEl)).toBeNull();
  });

  // 24. DOB semantic detection
  it('24. DOB semantic detection: recognizes date of birth fields while excluding expiry and event dates', () => {
    const dobEl = makeElement({
      label: 'Date of Birth (DOB)',
      input: {
        type: 'text',
        autocomplete: 'bday',
        name: 'birth_date',
        placeholder: 'DD/MM/YYYY',
        is_password: false,
        has_value: true,
        value: '15/08/1990',
      },
    });

    const expiryDateEl = makeElement({
      label: 'Subscription Expiry Date',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'expiry',
        placeholder: 'DD/MM/YYYY',
        is_password: false,
        has_value: true,
        value: '31/12/2026',
      },
    });

    const dobRes = classifyDomElement(dobEl);
    expect(dobRes?.category).toBe('DOB');
    expect(dobRes?.confidence).toBeGreaterThanOrEqual(0.90);

    expect(classifyDomElement(expiryDateEl)).toBeNull();
  });

  // 25. Random numeric strings
  it('25. Random numeric strings: rejects uncorroborated 8, 10, 12, 16 digit numbers without semantic PII evidence', () => {
    const num8 = makeElement({ label: 'Item Metric', text: '12345678' });
    const num10 = makeElement({ label: 'Timestamp Counter', text: '1727500000' });
    const num12 = makeElement({ label: 'Catalog SKU', text: '998877665544' });
    const num16 = makeElement({ label: 'Telemetry Sequence', text: '1234567812345670' });

    expect(classifyDomElement(num8)).toBeNull();
    expect(classifyDomElement(num10)).toBeNull();
    expect(classifyDomElement(num12)).toBeNull();
    expect(classifyDomElement(num16)).toBeNull();
  });

  // 26. Random alphanumeric strings
  it('26. Random alphanumeric strings: rejects UUIDs, hexadecimal hashes, and ordinary UI identifiers', () => {
    const uuidEl = makeElement({ label: 'Trace ID', text: 'c066367a-6faf-4528-b62f-3de6af06babd' });
    const hexEl = makeElement({ label: 'Commit Hash', text: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    const cssClassEl = makeElement({ label: 'Component Class', text: 'btn-primary-active' });

    expect(classifyDomElement(uuidEl)).toBeNull();
    expect(classifyDomElement(hexEl)).toBeNull();
    expect(classifyDomElement(cssClassEl)).toBeNull();
  });

  // 27. Multiple PII types in one DOM
  it('27. Multiple PII types in one DOM: simultaneously detects all distinct Indian PII categories across form elements', () => {
    const elements: DomElementInfo[] = [
      makeElement({ dom_id: 'e1', label: 'Aadhaar Number', input: { type: 'text', autocomplete: null, name: 'aadh', placeholder: null, is_password: false, has_value: true, value: '2345 6789 0124' } }),
      makeElement({ dom_id: 'e2', label: 'Permanent Account Number', input: { type: 'text', autocomplete: null, name: 'pan', placeholder: null, is_password: false, has_value: true, value: 'ABCPE1234F' } }),
      makeElement({ dom_id: 'e3', label: 'Contact Mobile', input: { type: 'tel', autocomplete: 'tel', name: 'mob', placeholder: null, is_password: false, has_value: true, value: '+91 9876543210' } }),
      makeElement({ dom_id: 'e4', label: 'Primary Email', input: { type: 'email', autocomplete: 'email', name: 'email', placeholder: null, is_password: false, has_value: true, value: 'rishi@example.gov.in' } }),
      makeElement({ dom_id: 'e5', label: 'Bank Savings Account', input: { type: 'text', autocomplete: null, name: 'acct', placeholder: null, is_password: false, has_value: true, value: '123456789012' } }),
      makeElement({ dom_id: 'e6', label: 'Bank IFSC', input: { type: 'text', autocomplete: null, name: 'ifsc', placeholder: null, is_password: false, has_value: true, value: 'HDFC0000240' } }),
      makeElement({ dom_id: 'e7', label: 'UPI Handle', input: { type: 'text', autocomplete: null, name: 'upi', placeholder: null, is_password: false, has_value: true, value: 'rishi@okhdfcbank' } }),
      makeElement({ dom_id: 'e8', label: 'Card Payment', input: { type: 'text', autocomplete: 'cc-number', name: 'cc', placeholder: null, is_password: false, has_value: true, value: '4111 1111 1111 1111' } }),
    ];

    const candidates = classifyAllElements(elements);
    expect(candidates.length).toBe(8);

    const subtypes = new Set(candidates.map((c) => c.specificSubtype));
    expect(subtypes.has('AADHAAR')).toBe(true);
    expect(subtypes.has('PAN')).toBe(true);
    expect(subtypes.has('PHONE')).toBe(true);
    expect(subtypes.has('EMAIL')).toBe(true);
    expect(subtypes.has('BANK_ACCOUNT')).toBe(true);
    expect(subtypes.has('IFSC')).toBe(true);
    expect(subtypes.has('UPI')).toBe(true);
    expect(subtypes.has('CARD')).toBe(true);
  });

  // 28. Multiple detectors on same element
  it('28. Multiple detectors on same element: resolves to highest priority/confidence detector deterministically', () => {
    // An element having both "account" keyword and specific "PAN" format should resolve to PAN (higher priority 95 vs 60)
    const dualEl = makeElement({
      dom_id: 'dual_cue',
      label: 'Permanent Account Number PAN Card',
      input: {
        type: 'text',
        autocomplete: null,
        name: 'pan_acct',
        placeholder: 'ABCPE1234F',
        is_password: false,
        has_value: true,
        value: 'ABCPE1234F',
      },
    });

    const res = classifyDomElement(dualEl);
    expect(res?.specificSubtype).toBe('PAN');
    expect(res?.category).toBe('GOV_ID');
  });

  // 29. Candidate deduplication
  it('29. Candidate deduplication: preserves single deterministic candidate when scanned repeatedly', () => {
    const el = makeElement({
      dom_id: 'dedup_1',
      label: 'Resident Aadhaar',
      input: { type: 'text', autocomplete: null, name: 'aadh', placeholder: null, is_password: false, has_value: true, value: '2345 6789 0124' },
    });

    const list = [el, el, el];
    const results = classifyAllElements(list);

    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('pii_aadhaar_dedup_1');
  });

  // 30. Confidence scoring
  it('30. Confidence scoring: reinforces confidence proportionally with structural verification and semantic context', () => {
    const phoneNoContext = makeElement({
      label: 'Number Value',
      input: { type: 'text', autocomplete: null, name: 'num', placeholder: null, is_password: false, has_value: true, value: '+91 9876543210' },
    });
    const phoneWithContext = makeElement({
      label: 'Mobile Contact Number',
      input: { type: 'tel', autocomplete: 'tel', name: 'mob', placeholder: '+91 9876543210', is_password: false, has_value: true, value: '+91 9876543210' },
    });

    const res1 = classifyDomElement(phoneNoContext);
    const res2 = classifyDomElement(phoneWithContext);

    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    expect(res2!.confidence).toBeGreaterThanOrEqual(res1!.confidence);
  });

  // 31. Existing Phase 3 regression
  it('31. Existing Phase 3 regression: core password and generic form classifications remain identical', () => {
    const pwdEl = makeElement({
      label: 'Account Password',
      input: { type: 'password', autocomplete: 'current-password', name: 'pwd', placeholder: null, is_password: true, has_value: true, value: 'Secret123!' },
    });

    const cand = classifyDomElement(pwdEl);
    expect(cand?.category).toBe('PASSWORD');
    expect(cand?.confidence).toBe(1.0);
    expect(cand?.isMandatory).toBe(true);
  });

  // 32. Existing DOM masking regression
  it('32. Existing DOM masking regression: multi-PII Indian form passes end-to-end redaction in privacy engine', async () => {
    const aadhaarEl = makeElement({
      dom_id: 'in_aadhaar_mask',
      label: 'Resident Aadhaar',
      input: { type: 'text', autocomplete: null, name: 'aadhaar', placeholder: null, is_password: false, has_value: true, value: '2345 6789 0124' },
    });
    const panEl = makeElement({
      dom_id: 'in_pan_mask',
      label: 'Income Tax PAN',
      input: { type: 'text', autocomplete: null, name: 'pan', placeholder: null, is_password: false, has_value: true, value: 'ABCPE1234F' },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_p4_reg',
      url_origin: 'http://localhost:5173',
      url_path: '/gov/onboard',
      frames: [],
      elements: [aadhaarEl, panEl],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_p4',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_p4_reg',
      task: {
        task_id: 't_p4',
        task_text: 'identity verification',
        allowed_actions: ['type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_p4_reg',
        cycle_id: 'c_p4_reg',
        page_state_hash: 'hash_p4',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_aadh',
            dom_id: 'in_aadhaar_mask',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 20, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: '2345 6789 0124',
            clean_text: '2345 6789 0124',
            interactable: true,
          },
          {
            region_id: 'r_pan',
            dom_id: 'in_pan_mask',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 60, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: 'ABCPE1234F',
            clean_text: 'ABCPE1234F',
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
    expect(res.detections.length).toBeGreaterThanOrEqual(2);
    expect(res.redaction.text_replacements).toBeGreaterThanOrEqual(2);
  });

  // 33. Sanitized observation contains no raw detected PII
  it('33. Sanitized observation contains no raw detected PII: raw Aadhaar and PAN strings are scrubbed', async () => {
    const rawAadhaar = '2345 6789 0124';
    const rawPan = 'ABCPE1234F';

    const aadhaarEl = makeElement({
      dom_id: 'in_aadhaar_clean',
      label: 'Resident Aadhaar',
      input: { type: 'text', autocomplete: null, name: 'aadhaar', placeholder: null, is_password: false, has_value: true, value: rawAadhaar },
    });
    const panEl = makeElement({
      dom_id: 'in_pan_clean',
      label: 'Income Tax PAN',
      input: { type: 'text', autocomplete: null, name: 'pan', placeholder: null, is_password: false, has_value: true, value: rawPan },
    });

    const mockSnapshot: DomSnapshot = {
      snapshot_id: 's_p4_clean',
      url_origin: 'http://localhost:5173',
      url_path: '/gov/onboard',
      frames: [],
      elements: [aadhaarEl, panEl],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: 'hash_p4_clean',
      ts: Date.now(),
    };

    const req: SanitizeRequest = {
      cycle_id: 'c_p4_clean',
      task: {
        task_id: 't_p4_clean',
        task_text: 'attestation verification',
        allowed_actions: ['type'],
        allowed_origins: ['http://localhost:5173'],
        step_index: 0,
        history: [],
      },
      frame: {
        frame_uid: 'f_p4_clean',
        cycle_id: 'c_p4_clean',
        page_state_hash: 'hash_p4_clean',
        origin: 'http://localhost:5173',
        regions: [
          {
            region_id: 'r_aadh_clean',
            dom_id: 'in_aadhaar_clean',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 20, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: rawAadhaar,
            clean_text: rawAadhaar,
            interactable: true,
          },
          {
            region_id: 'r_pan_clean',
            dom_id: 'in_pan_clean',
            frame_id: 'main',
            origin: 'http://localhost:5173',
            semantic_type: 'input',
            box_label: 'input',
            bbox: [10, 60, 200, 30],
            source_type: 'DOM',
            sensitive: false,
            suggested_treatment: 'ALLOW',
            visual_text: rawPan,
            clean_text: rawPan,
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
    expect(res.attested?.body).toBeDefined();

    // The attested output string MUST NOT contain raw unmasked Aadhaar or PAN values
    expect(res.attested!.body.includes(rawAadhaar)).toBe(false);
    expect(res.attested!.body.includes(rawPan)).toBe(false);
  });
});
