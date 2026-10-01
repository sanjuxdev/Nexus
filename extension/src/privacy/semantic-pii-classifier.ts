import type { BBox } from '../../contracts/ts/common.js';
import type { DomElementInfo } from '../../contracts/ts/dom.js';
import type { PiiType } from '../../contracts/ts/privacy.js';

/**
 * Phase 3: Semantic PII Classification Layer
 * 
 * Consumes the enhanced DOM/ARIA representation (Phases 1-2) and performs
 * isolated, conservative semantic classification to identify PII candidates
 * across form controls, inputs, and associated ARIA metadata.
 * 
 * Pipeline:
 * DOM + ARIA -> Semantic Representation -> PII Classification -> PII Candidate -> Existing Redaction Boundary
 */

export interface PiiSignalEvidence {
  field:
    | 'role'
    | 'name'
    | 'description'
    | 'label'
    | 'placeholder'
    | 'type'
    | 'autocomplete'
    | 'id'
    | 'element_name'
    | 'value'
    | 'surrounding_text';
  matchedValue: string;
  matchedRule: string;
  signalStrength: 'high' | 'medium' | 'low';
}

export interface PiiCandidate {
  id: string; // Unique deterministic candidate ID, e.g. `pii_email_d1`
  category: PiiType;
  specificSubtype?: string; // e.g. 'AADHAAR' | 'PAN' | 'CREDIT_CARD' | 'PASSWORD'
  confidence: number; // 0.0 to 1.0
  sourceElement: {
    dom_id?: string;
    element_id?: string | null;
    element_name?: string | null;
    role?: string | null;
    tag?: string;
    stable_selector?: string | null;
  };
  reason: string;
  evidence: PiiSignalEvidence[];
  bbox: BBox | null;
  valueReference: string | null; // Sanitized replacement token (NEVER raw unmasked secret)
  isMandatory: boolean;
}

export interface ClassificationContext {
  surroundingText?: string;
  formName?: string;
  parentRole?: string;
}

// False positive exclusion patterns
const FALSE_POSITIVE_PATTERNS = {
  PHONE: /\b(?:headphone|microphone|gramophone|megaphone|saxophone|phone\s*booth|phone\s*stand|phone\s*case|smartphone\s*review)\b/i,
  PAN: /\b(?:panoramic|pantry|japan|company\s*panel|pan\s*handle|frying\s*pan|pan\s*tilt|steel\s*pan|span)\b/i,
  CARD: /\b(?:cardboard|wildcard|postcard|greeting\s*card|sim\s*card|sd\s*card|graphics\s*card|sound\s*card|tarot\s*card)\b/i,
  ADDRESS: /\b(?:ip\s*address|mac\s*address|web\s*address|url\s*address|email\s*address|memory\s*address)\b/i,
  DOB: /\b(?:release\s*date|event\s*date|expiry\s*date|due\s*date|creation\s*date|update\s*date|start\s*date|end\s*date|meeting\s*date)\b/i,
  PERSON: /\b(?:file\s*name|product\s*name|brand\s*name|domain\s*name|host\s*name|company\s*name|organization\s*name|class\s*name|tag\s*name|server\s*name|variable\s*name|model\s*name)\b/i,
  PASSWORD: /\b(?:pin\s*code|pincode|safety\s*pin|pin\s*point|pinboard|bowling\s*pin|tie\s*pin)\b/i,
  EMAIL: /\b(?:voice\s*mail|voicemail|mailman|chain\s*mail|daily\s*mail|mail\s*room|mail\s*bag|air\s*mail|mail\s*slot)\b/i,
};

/**
 * Checks if a string contains non-PII false-positive terminology for a category.
 */
function isFalsePositive(text: string, category: keyof typeof FALSE_POSITIVE_PATTERNS): boolean {
  if (!text) return false;
  const pattern = FALSE_POSITIVE_PATTERNS[category];
  return Boolean(pattern && pattern.test(text));
}

/**
 * Checks if an element is an action button or link that shouldn't be masked as an input field.
 */
function isActionControl(el: DomElementInfo): boolean {
  const role = (el.role || '').toLowerCase();
  const tag = (el.tag || '').toLowerCase();
  const type = (el.input?.type || '').toLowerCase();

  if (type === 'button' || type === 'submit' || type === 'reset') return true;
  if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') return true;
  if (tag === 'button' || tag === 'a') return true;

  return false;
}

/**
 * Normalizes input text for keyword searching.
 */
function normalize(str: string | null | undefined): string {
  return (str || '').trim().toLowerCase();
}

import { indianPiiRegistry } from './indian-pii-registry.js';

/**
 * Classifies a single DOM element based on its semantic representation.
 * Returns a high-confidence PII candidate or null if non-PII / ambiguous.
 */
export function classifyDomElement(
  el: DomElementInfo,
  context?: ClassificationContext
): PiiCandidate | null {
  if (!el) return null;

  // Action controls (buttons, navigation links) trigger actions, not PII fields
  if (isActionControl(el)) {
    return null;
  }

  // 0. Delegate to Phase 4 Indian PII Registry
  const registryCandidate = indianPiiRegistry.detectElement(el, {
    surroundingText: context?.surroundingText,
    formName: context?.formName,
  });
  if (registryCandidate && registryCandidate.confidence >= 0.70) {
    return registryCandidate;
  }

  const role = normalize(el.role);
  const tag = normalize(el.tag);
  const accessibleName = normalize(el.name);
  const label = normalize(el.label);
  const description = normalize(el.description);
  const ariaLabel = normalize(el.aria_label);
  const placeholder = normalize(el.input?.placeholder);
  const inputType = normalize(el.input?.type);
  const autocomplete = normalize(el.input?.autocomplete);
  const elementName = normalize(el.element_name || el.input?.name);
  const elementId = normalize(el.element_id || el.dom_id);
  const isPassword = Boolean(el.input?.is_password || inputType === 'password');
  const surrounding = normalize(context?.surroundingText);

  const combinedSearchText = [
    accessibleName,
    label,
    description,
    ariaLabel,
    placeholder,
    elementName,
    elementId,
    surrounding,
  ].filter(Boolean).join(' ');

  // -------------------------------------------------------------
  // 1. PASSWORD / AUTH_TOKEN
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    if (isPassword || inputType === 'password') {
      evidence.push({
        field: 'type',
        matchedValue: inputType || 'password',
        matchedRule: 'is_password_flag',
        signalStrength: 'high',
      });
    }

    if (['current-password', 'new-password', 'one-time-code'].includes(autocomplete)) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: `autocomplete_${autocomplete}`,
        signalStrength: 'high',
      });
    }

    const pwdKeywordRegex = /\b(?:password|passcode|passphrase|secret_key|api_key|auth_token|access_token|totp|otp)\b/i;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && pwdKeywordRegex.test(val) && !isFalsePositive(val, 'PASSWORD')) {
        evidence.push({
          field,
          matchedValue: val,
          matchedRule: 'keyword_password',
          signalStrength: 'high',
        });
      }
    }

    // Medium signal: "pin" without false positives like "pin code"
    if (evidence.length === 0) {
      const pinRegex = /\bpin\b/i;
      for (const [field, val] of [
        ['label', label],
        ['placeholder', placeholder],
        ['name', accessibleName],
      ] as const) {
        if (val && pinRegex.test(val) && !isFalsePositive(val, 'PASSWORD')) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'keyword_pin',
            signalStrength: 'medium',
          });
        }
      }
    }

    if (evidence.length > 0) {
      const isHigh = evidence.some((e) => e.signalStrength === 'high');
      const confidence = isHigh ? Math.min(1.0, 0.95 + (evidence.length - 1) * 0.03) : 0.65;

      if (confidence >= 0.7) {
        const isAuthToken = combinedSearchText.includes('token') || combinedSearchText.includes('api_key');
        const category: PiiType = isAuthToken ? 'AUTH_TOKEN' : 'PASSWORD';
        return {
          id: `pii_${category.toLowerCase()}_${el.dom_id || el.element_id || 'el'}`,
          category,
          specificSubtype: category,
          confidence,
          sourceElement: {
            dom_id: el.dom_id,
            element_id: el.element_id,
            element_name: el.element_name || el.input?.name,
            role: el.role,
            tag: el.tag,
            stable_selector: el.stable_selector,
          },
          reason: `High confidence ${category}: verified via ${evidence.map((e) => e.field).join(', ')}`,
          evidence,
          bbox: el.bbox,
          valueReference: `<REDACTED_${category}>`,
          isMandatory: true,
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 2. GOV_ID (Aadhaar, PAN, SSN, Passport)
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    // Aadhaar check
    const aadhaarRegex = /\b(?:aadhaar|aadhar|uidai)\b/i;
    let isAadhaar = false;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && aadhaarRegex.test(val)) {
        evidence.push({
          field,
          matchedValue: val,
          matchedRule: 'aadhaar_keyword',
          signalStrength: 'high',
        });
        isAadhaar = true;
      }
    }

    // Aadhaar placeholder mask (e.g. "xxxx xxxx xxxx" or "12 digit")
    if (placeholder && (placeholder.includes('xxxx') || placeholder.includes('12-digit') || placeholder.includes('12 digit'))) {
      evidence.push({
        field: 'placeholder',
        matchedValue: placeholder,
        matchedRule: 'aadhaar_placeholder_pattern',
        signalStrength: 'high',
      });
      isAadhaar = true;
    }

    // PAN check (with false-positive protection)
    let isPan = false;
    if (!isAadhaar && !isFalsePositive(combinedSearchText, 'PAN')) {
      const panStrictRegex = /\b(?:pan\s*card|pan\s*number|permanent\s*account\s*number)\b/i;
      const panWordRegex = /\bpan\b/i;

      for (const [field, val] of [
        ['label', label],
        ['name', accessibleName],
        ['placeholder', placeholder],
        ['element_name', elementName],
        ['id', elementId],
      ] as const) {
        if (val && (panStrictRegex.test(val) || panWordRegex.test(val))) {
          if (!isFalsePositive(val, 'PAN')) {
            evidence.push({
              field,
              matchedValue: val,
              matchedRule: 'pan_keyword',
              signalStrength: 'high',
            });
            isPan = true;
          }
        }
      }
    }

    // Other national IDs (SSN, Passport, Voter ID)
    let isOtherGovId = false;
    if (!isAadhaar && !isPan) {
      const govIdRegex = /\b(?:ssn|social\s*security|national\s*id|voter\s*id|passport\s*number|passport\s*no)\b/i;
      for (const [field, val] of [
        ['label', label],
        ['name', accessibleName],
        ['placeholder', placeholder],
        ['element_name', elementName],
        ['id', elementId],
      ] as const) {
        if (val && govIdRegex.test(val)) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'govid_keyword',
            signalStrength: 'high',
          });
          isOtherGovId = true;
        }
      }
    }

    if (evidence.length > 0) {
      const subtype = isAadhaar ? 'AADHAAR' : isPan ? 'PAN' : 'GOV_ID';
      const confidence = Math.min(1.0, 0.95 + (evidence.length - 1) * 0.03);

      return {
        id: `pii_govid_${subtype.toLowerCase()}_${el.dom_id || el.element_id || 'el'}`,
        category: 'GOV_ID',
        specificSubtype: subtype,
        confidence,
        sourceElement: {
          dom_id: el.dom_id,
          element_id: el.element_id,
          element_name: el.element_name || el.input?.name,
          role: el.role,
          tag: el.tag,
          stable_selector: el.stable_selector,
        },
        reason: `High confidence GOV_ID (${subtype}): verified via ${evidence.map((e) => e.field).join(', ')}`,
        evidence,
        bbox: el.bbox,
        valueReference: `<REDACTED_${subtype}>`,
        isMandatory: true,
      };
    }
  }

  // -------------------------------------------------------------
  // 3. EMAIL
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    if (inputType === 'email') {
      evidence.push({
        field: 'type',
        matchedValue: inputType,
        matchedRule: 'type_email',
        signalStrength: 'high',
      });
    }

    if (autocomplete === 'email') {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: 'autocomplete_email',
        signalStrength: 'high',
      });
    }

    const emailKeywordRegex = /\b(?:email|e-mail|mail\s*address)\b/i;
    const emailAddressRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && !isFalsePositive(val, 'EMAIL')) {
        if (emailKeywordRegex.test(val)) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'keyword_email',
            signalStrength: 'high',
          });
        } else if (emailAddressRegex.test(val)) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'pattern_email_address',
            signalStrength: 'high',
          });
        }
      }
    }

    if (evidence.length > 0) {
      const confidence = Math.min(1.0, 0.92 + (evidence.length - 1) * 0.03);
      return {
        id: `pii_email_${el.dom_id || el.element_id || 'el'}`,
        category: 'EMAIL',
        specificSubtype: 'EMAIL',
        confidence,
        sourceElement: {
          dom_id: el.dom_id,
          element_id: el.element_id,
          element_name: el.element_name || el.input?.name,
          role: el.role,
          tag: el.tag,
          stable_selector: el.stable_selector,
        },
        reason: `High confidence EMAIL: verified via ${evidence.map((e) => e.field).join(', ')}`,
        evidence,
        bbox: el.bbox,
        valueReference: '<EMAIL>',
        isMandatory: true,
      };
    }
  }

  // -------------------------------------------------------------
  // 4. PHONE
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    if (inputType === 'tel') {
      evidence.push({
        field: 'type',
        matchedValue: inputType,
        matchedRule: 'type_tel',
        signalStrength: 'high',
      });
    }

    if (['tel', 'tel-national', 'tel-country-code', 'mobile'].includes(autocomplete)) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: `autocomplete_${autocomplete}`,
        signalStrength: 'high',
      });
    }

    const phoneKeywordRegex = /\b(?:phone|mobile|cell\s*number|telephone|contact\s*no|whatsapp)\b/i;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && phoneKeywordRegex.test(val) && !isFalsePositive(val, 'PHONE')) {
        evidence.push({
          field,
          matchedValue: val,
          matchedRule: 'keyword_phone',
          signalStrength: 'high',
        });
      }
    }

    if (evidence.length > 0) {
      const confidence = Math.min(1.0, 0.92 + (evidence.length - 1) * 0.03);
      return {
        id: `pii_phone_${el.dom_id || el.element_id || 'el'}`,
        category: 'PHONE',
        specificSubtype: 'PHONE',
        confidence,
        sourceElement: {
          dom_id: el.dom_id,
          element_id: el.element_id,
          element_name: el.element_name || el.input?.name,
          role: el.role,
          tag: el.tag,
          stable_selector: el.stable_selector,
        },
        reason: `High confidence PHONE: verified via ${evidence.map((e) => e.field).join(', ')}`,
        evidence,
        bbox: el.bbox,
        valueReference: '<PHONE>',
        isMandatory: true,
      };
    }
  }

  // -------------------------------------------------------------
  // 5. CARD / BANK_ACCOUNT
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    const cardAutocompletes = [
      'cc-number',
      'cc-exp',
      'cc-exp-month',
      'cc-exp-year',
      'cc-csc',
      'cc-type',
      'bacs-account-number',
    ];
    if (cardAutocompletes.includes(autocomplete)) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: `autocomplete_${autocomplete}`,
        signalStrength: 'high',
      });
    }

    const cardKeywordRegex = /\b(?:credit\s*card|debit\s*card|card\s*number|cvv|cvc|card\s*expiry|exp\s*date|security\s*code)\b/i;
    const bankKeywordRegex = /\b(?:bank\s*account|account\s*number|ifsc|routing\s*number|iban)\b/i;

    let isCard = autocomplete.startsWith('cc-');
    let isBank = autocomplete === 'bacs-account-number';

    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && !isFalsePositive(val, 'CARD')) {
        if (cardKeywordRegex.test(val)) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'card_keyword',
            signalStrength: 'high',
          });
          isCard = true;
        } else if (bankKeywordRegex.test(val)) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'bank_keyword',
            signalStrength: 'high',
          });
          isBank = true;
        }
      }
    }

    if (evidence.length > 0) {
      const category: PiiType = isBank ? 'BANK_ACCOUNT' : 'CARD';
      const confidence = Math.min(1.0, 0.95 + (evidence.length - 1) * 0.03);

      return {
        id: `pii_${category.toLowerCase()}_${el.dom_id || el.element_id || 'el'}`,
        category,
        specificSubtype: category,
        confidence,
        sourceElement: {
          dom_id: el.dom_id,
          element_id: el.element_id,
          element_name: el.element_name || el.input?.name,
          role: el.role,
          tag: el.tag,
          stable_selector: el.stable_selector,
        },
        reason: `High confidence ${category}: verified via ${evidence.map((e) => e.field).join(', ')}`,
        evidence,
        bbox: el.bbox,
        valueReference: `<REDACTED_${category}>`,
        isMandatory: true,
      };
    }
  }

  // -------------------------------------------------------------
  // 6. PERSON (Full Name, First/Last Name)
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    const personAutocompletes = ['name', 'given-name', 'family-name', 'additional-name'];
    if (personAutocompletes.includes(autocomplete)) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: `autocomplete_${autocomplete}`,
        signalStrength: 'high',
      });
    }

    const explicitNameRegex = /\b(?:full\s*name|first\s*name|last\s*name|middle\s*name|sur\s*name|legal\s*name|candidate\s*name|father'?s?\s*name|mother'?s?\s*name|spouse'?s?\s*name)\b/i;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && explicitNameRegex.test(val) && !isFalsePositive(val, 'PERSON')) {
        evidence.push({
          field,
          matchedValue: val,
          matchedRule: 'explicit_name_keyword',
          signalStrength: 'high',
        });
      }
    }

    // Ambiguous generic "name" check on text inputs
    if (evidence.length === 0 && (tag === 'input' || role === 'textbox')) {
      const genericNameRegex = /^(?:name|your\s*name)$/i;
      for (const [field, val] of [
        ['label', label],
        ['placeholder', placeholder],
        ['name', accessibleName],
      ] as const) {
        if (val && genericNameRegex.test(val) && !isFalsePositive(val, 'PERSON')) {
          evidence.push({
            field,
            matchedValue: val,
            matchedRule: 'generic_name_keyword',
            signalStrength: 'medium',
          });
        }
      }
    }

    if (evidence.length > 0) {
      const hasHighSignal = evidence.some((e) => e.signalStrength === 'high');
      const confidence = hasHighSignal
        ? Math.min(1.0, 0.88 + (evidence.length - 1) * 0.04)
        : 0.60;

      if (confidence >= 0.7) {
        return {
          id: `pii_person_${el.dom_id || el.element_id || 'el'}`,
          category: 'PERSON',
          specificSubtype: 'PERSON',
          confidence,
          sourceElement: {
            dom_id: el.dom_id,
            element_id: el.element_id,
            element_name: el.element_name || el.input?.name,
            role: el.role,
            tag: el.tag,
            stable_selector: el.stable_selector,
          },
          reason: `High confidence PERSON: verified via ${evidence.map((e) => e.field).join(', ')}`,
          evidence,
          bbox: el.bbox,
          valueReference: '<REDACTED_NAME>',
          isMandatory: true,
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 7. ADDRESS
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    const addressAutocompletes = [
      'street-address',
      'address-line1',
      'address-line2',
      'address-line3',
      'address-level1',
      'address-level2',
      'postal-code',
      'country-name',
    ];
    if (addressAutocompletes.includes(autocomplete)) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: `autocomplete_${autocomplete}`,
        signalStrength: 'high',
      });
    }

    const addressKeywordRegex = /\b(?:street\s*address|residential\s*address|home\s*address|billing\s*address|shipping\s*address|postal\s*code|pin\s*code|zip\s*code)\b/i;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && addressKeywordRegex.test(val) && !isFalsePositive(val, 'ADDRESS')) {
        evidence.push({
          field,
          matchedValue: val,
          matchedRule: 'address_keyword',
          signalStrength: 'high',
        });
      }
    }

    if (evidence.length > 0) {
      const confidence = Math.min(1.0, 0.90 + (evidence.length - 1) * 0.03);
      return {
        id: `pii_address_${el.dom_id || el.element_id || 'el'}`,
        category: 'ADDRESS',
        specificSubtype: 'ADDRESS',
        confidence,
        sourceElement: {
          dom_id: el.dom_id,
          element_id: el.element_id,
          element_name: el.element_name || el.input?.name,
          role: el.role,
          tag: el.tag,
          stable_selector: el.stable_selector,
        },
        reason: `High confidence ADDRESS: verified via ${evidence.map((e) => e.field).join(', ')}`,
        evidence,
        bbox: el.bbox,
        valueReference: '<REDACTED_ADDRESS>',
        isMandatory: true,
      };
    }
  }

  // -------------------------------------------------------------
  // 8. DOB
  // -------------------------------------------------------------
  {
    const evidence: PiiSignalEvidence[] = [];

    const dobAutocompletes = ['bday', 'bday-day', 'bday-month', 'bday-year'];
    if (dobAutocompletes.includes(autocomplete)) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: autocomplete,
        matchedRule: `autocomplete_${autocomplete}`,
        signalStrength: 'high',
      });
    }

    const dobKeywordRegex = /\b(?:date\s*of\s*birth|birth\s*date|birthdate|dob)\b/i;
    for (const [field, val] of [
      ['label', label],
      ['name', accessibleName],
      ['placeholder', placeholder],
      ['element_name', elementName],
      ['id', elementId],
    ] as const) {
      if (val && dobKeywordRegex.test(val) && !isFalsePositive(val, 'DOB')) {
        evidence.push({
          field,
          matchedValue: val,
          matchedRule: 'dob_keyword',
          signalStrength: 'high',
        });
      }
    }

    if (evidence.length > 0) {
      const confidence = Math.min(1.0, 0.92 + (evidence.length - 1) * 0.03);
      return {
        id: `pii_dob_${el.dom_id || el.element_id || 'el'}`,
        category: 'DOB',
        specificSubtype: 'DOB',
        confidence,
        sourceElement: {
          dom_id: el.dom_id,
          element_id: el.element_id,
          element_name: el.element_name || el.input?.name,
          role: el.role,
          tag: el.tag,
          stable_selector: el.stable_selector,
        },
        reason: `High confidence DOB: verified via ${evidence.map((e) => e.field).join(', ')}`,
        evidence,
        bbox: el.bbox,
        valueReference: '<REDACTED_DOB>',
        isMandatory: true,
      };
    }
  }

  // Non-PII or ambiguous below threshold
  return null;
}

/**
 * Classifies an entire set of DOM elements and returns deduplicated PII candidates.
 */
export function classifyAllElements(
  elements: DomElementInfo[],
  context?: ClassificationContext
): PiiCandidate[] {
  if (!elements || !Array.isArray(elements)) return [];

  const candidates: PiiCandidate[] = [];
  const seenIds = new Set<string>();

  for (const el of elements) {
    const cand = classifyDomElement(el, context);
    if (cand && !seenIds.has(cand.id)) {
      seenIds.add(cand.id);
      candidates.push(cand);
    }
  }

  return candidates;
}

/**
 * Convenience predicate to quickly check if a DOM element is likely PII.
 */
export function isLikelyPiiElement(el: DomElementInfo): boolean {
  return classifyDomElement(el) !== null;
}
