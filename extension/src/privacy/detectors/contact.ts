import type { DetectorContext, DetectorValidationResult, PiiDetector, PiiSignalEvidence } from './types.js';

function getSemanticKeywords(context?: DetectorContext): string {
  if (!context?.element) return (context?.surroundingText || '').toLowerCase();
  const el = context.element;
  return [
    el.name,
    el.label,
    el.description,
    el.aria_label,
    el.input?.placeholder,
    el.input?.name,
    el.element_name,
    el.element_id,
    context.surroundingText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * 1. Indian Phone / Mobile Detector
 */
export const indianPhoneDetector: PiiDetector = {
  id: 'indian-phone-detector',
  category: 'PHONE',
  specificSubtype: 'PHONE',
  priority: 75,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('phone') || sem.includes('mobile') || sem.includes('contact') || sem.includes('telephone') || sem.includes('whatsapp')) {
      return true;
    }
    if (context?.element?.input?.type === 'tel' || context?.element?.input?.autocomplete?.includes('tel')) {
      return true;
    }
    return /(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against audio accessories, non-phone words & non-phone numbers (orders, serials)
    if (/\b(?:headphone|microphone|gramophone|megaphone|saxophone|phone\s*booth|phone\s*stand|phone\s*case|smartphone\s*review)\b/i.test(sem) ||
        /\b(?:headphone|microphone|megaphone)\b/i.test(text) ||
        /\b(?:order|ord|invoice|inv|tracking|track|serial|reference|ref|booking|receipt|shipment|sku|item|product\s*id|timestamp|counter|quantity|metric)\b/i.test(sem) ||
        /\b(?:order|ord|invoice|inv|tracking|track)[\s#_-]?[a-z0-9_-]*/i.test(text)) {
      return null;
    }

    const el = context?.element;
    const evidence: PiiSignalEvidence[] = [];

    if (el?.input?.type === 'tel') {
      evidence.push({
        field: 'type',
        matchedValue: el.input.type,
        matchedRule: 'phone_field_type',
        signalStrength: 'high',
      });
    }
    if (el?.input?.autocomplete && el.input.autocomplete.includes('tel')) {
      evidence.push({
        field: 'autocomplete',
        matchedValue: el.input.autocomplete,
        matchedRule: 'phone_autocomplete',
        signalStrength: 'high',
      });
    }
    if (el?.label && /phone|mobile|contact|telephone|cell/i.test(el.label)) {
      evidence.push({
        field: 'label',
        matchedValue: el.label,
        matchedRule: 'phone_label_keyword',
        signalStrength: 'high',
      });
    }
    if (el?.input?.placeholder && /(?:\+91|[6-9]\d{4}|phone|mobile)/i.test(el.input.placeholder)) {
      evidence.push({
        field: 'placeholder',
        matchedValue: el.input.placeholder,
        matchedRule: 'phone_placeholder',
        signalStrength: 'high',
      });
    }
    if (el?.name && /phone|mobile|contact|telephone/i.test(el.name)) {
      evidence.push({
        field: 'name',
        matchedValue: el.name,
        matchedRule: 'phone_name_keyword',
        signalStrength: 'high',
      });
    }
    if (el?.element_name && /phone|mobile|contact|telephone/i.test(el.element_name)) {
      evidence.push({
        field: 'element_name',
        matchedValue: el.element_name,
        matchedRule: 'phone_element_name',
        signalStrength: 'high',
      });
    }

    const hasPhoneContext =
      evidence.length > 0 ||
      sem.includes('phone') ||
      sem.includes('mobile') ||
      sem.includes('contact') ||
      sem.includes('telephone') ||
      sem.includes('whatsapp') ||
      el?.input?.type === 'tel' ||
      el?.input?.autocomplete?.includes('tel');

    // Strict Indian mobile regex: 10 digits starting with 6-9, with optional +91 or 0 prefix
    const phoneRegex = /(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
    const matches = text.match(phoneRegex);

    if (matches) {
      for (const rawMatch of matches) {
        // Strip country code, leading zeros, separators
        let digitsOnly = rawMatch.replace(/[\s-]/g, '');
        if (digitsOnly.startsWith('+91')) digitsOnly = digitsOnly.slice(3);
        else if (digitsOnly.startsWith('91') && digitsOnly.length === 12) digitsOnly = digitsOnly.slice(2);
        else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) digitsOnly = digitsOnly.slice(1);

        if (/^[6-9]\d{9}$/.test(digitsOnly)) {
          const matchEvidence = [
            ...evidence,
            {
              field: 'regex_structure' as const,
              matchedValue: rawMatch,
              matchedRule: 'indian_mobile_10digit_start_6to9',
              signalStrength: 'high' as const,
            },
          ];

          return {
            isValid: true,
            category: 'PHONE',
            specificSubtype: 'PHONE',
            normalizedValue: `+91${digitsOnly}`,
            confidence: (hasPhoneContext || evidence.length > 0) ? 0.98 : 0.85,
            reason: `Valid Indian mobile number (${rawMatch})${hasPhoneContext ? ' with supporting context' : ''}`,
            evidence: matchEvidence,
            valueReference: '<PHONE>',
            isMandatory: true,
          };
        }
      }
    }

    if (hasPhoneContext && el?.input) {
      return {
        isValid: true,
        category: 'PHONE',
        specificSubtype: 'PHONE',
        confidence: evidence.length >= 2 ? 0.95 : 0.90,
        reason: 'Semantic phone input field identified',
        evidence: evidence.length > 0 ? evidence : [
          {
            field: 'type',
            matchedValue: el.input.type || 'tel',
            matchedRule: 'phone_field_type',
            signalStrength: 'high',
          },
        ],
        valueReference: '<PHONE>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 2. Email Detector
 */
export const emailDetector: PiiDetector = {
  id: 'email-detector',
  category: 'EMAIL',
  specificSubtype: 'EMAIL',
  priority: 70,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('email') || sem.includes('e-mail') || sem.includes('mail address')) return true;
    if (context?.element?.input?.type === 'email' || context?.element?.input?.autocomplete === 'email') return true;
    return /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive exclusions for mail terms
    if (/\b(?:voice\s*mail|voicemail|mailman|chain\s*mail|daily\s*mail|mail\s*room|mail\s*bag|air\s*mail)\b/i.test(sem) ||
        /\b(?:voice\s*mail|voicemail)\b/i.test(text)) {
      return null;
    }

    const el = context?.element;
    const evidence: PiiSignalEvidence[] = [];

    if (el?.input?.type === 'email') {
      evidence.push({
        field: 'type',
        matchedValue: el.input.type,
        matchedRule: 'email_field_type',
        signalStrength: 'high',
      });
    }
    if (el?.input?.autocomplete === 'email') {
      evidence.push({
        field: 'autocomplete',
        matchedValue: el.input.autocomplete,
        matchedRule: 'email_autocomplete',
        signalStrength: 'high',
      });
    }
    if (el?.label && /email|e-mail|mail/i.test(el.label)) {
      evidence.push({
        field: 'label',
        matchedValue: el.label,
        matchedRule: 'email_label_keyword',
        signalStrength: 'high',
      });
    }
    if (el?.input?.placeholder && (/@/i.test(el.input.placeholder) || /email|e-mail|mail/i.test(el.input.placeholder))) {
      evidence.push({
        field: 'placeholder',
        matchedValue: el.input.placeholder,
        matchedRule: 'email_placeholder',
        signalStrength: 'high',
      });
    }
    if (el?.name && /email|e-mail|mail/i.test(el.name)) {
      evidence.push({
        field: 'name',
        matchedValue: el.name,
        matchedRule: 'email_name_keyword',
        signalStrength: 'high',
      });
    }
    if (el?.element_name && /email|e-mail|mail/i.test(el.element_name)) {
      evidence.push({
        field: 'element_name',
        matchedValue: el.element_name,
        matchedRule: 'email_element_name',
        signalStrength: 'high',
      });
    }

    const hasContext =
      evidence.length > 0 ||
      sem.includes('email') ||
      sem.includes('e-mail') ||
      sem.includes('mail address') ||
      el?.input?.type === 'email' ||
      el?.input?.autocomplete === 'email';

    const matches = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
    if (matches) {
      for (const match of matches) {
        const matchEvidence = [
          ...evidence,
          {
            field: 'regex_structure' as const,
            matchedValue: match,
            matchedRule: 'rfc5322_email_pattern',
            signalStrength: 'high' as const,
          },
        ];

        return {
          isValid: true,
          category: 'EMAIL',
          specificSubtype: 'EMAIL',
          normalizedValue: match.toLowerCase(),
          confidence: hasContext ? 1.0 : 0.98,
          reason: `Valid email address (${match})${hasContext ? ' in email context' : ''}`,
          evidence: matchEvidence,
          valueReference: '<EMAIL>',
          isMandatory: true,
        };
      }
    }

    if (hasContext && el?.input) {
      return {
        isValid: true,
        category: 'EMAIL',
        specificSubtype: 'EMAIL',
        confidence: evidence.length >= 2 ? 1.0 : 0.92,
        reason: 'Semantic email input field identified',
        evidence: evidence.length > 0 ? evidence : [
          {
            field: 'type',
            matchedValue: el.input.type || 'email',
            matchedRule: 'email_field_type',
            signalStrength: 'high',
          },
        ],
        valueReference: '<EMAIL>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 3. Physical Address & Indian PIN Code Detector
 */
export const addressDetector: PiiDetector = {
  id: 'address-detector',
  category: 'ADDRESS',
  specificSubtype: 'ADDRESS',
  priority: 65,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('address') || sem.includes('pincode') || sem.includes('pin code') || sem.includes('postal code') || sem.includes('zip')) {
      return true;
    }
    if (context?.element?.input?.autocomplete?.includes('address') || context?.element?.input?.autocomplete === 'postal-code') {
      return true;
    }
    return false;
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against non-physical addresses
    if (/\b(?:ip\s*address|mac\s*address|web\s*address|url\s*address|email\s*address|memory\s*address)\b/i.test(sem) ||
        /\b(?:ip\s*address|mac\s*address|web\s*address)\b/i.test(text)) {
      return null;
    }

    const hasAddressContext =
      sem.includes('street address') ||
      sem.includes('residential address') ||
      sem.includes('home address') ||
      sem.includes('billing address') ||
      sem.includes('shipping address') ||
      sem.includes('postal address') ||
      sem.includes('pincode') ||
      sem.includes('pin code') ||
      sem.includes('postal code') ||
      context?.element?.input?.autocomplete?.includes('address') ||
      context?.element?.input?.autocomplete === 'postal-code';

    // 6-digit Indian PIN code check (must start with 1-9)
    const pinMatches = text.match(/\b[1-9]\d{5}\b/g);
    if (pinMatches && hasAddressContext) {
      for (const pin of pinMatches) {
        return {
          isValid: true,
          category: 'ADDRESS',
          specificSubtype: 'PINCODE',
          normalizedValue: pin,
          confidence: 0.92,
          reason: `Indian postal PIN code (${pin}) corroborated by address context`,
          evidence: [
            {
              field: 'regex_structure',
              matchedValue: pin,
              matchedRule: 'indian_pincode_6digit_start_1to9',
              signalStrength: 'high',
            },
            {
              field: 'surrounding_text',
              matchedValue: 'address_context',
              matchedRule: 'pin_context_corroborated',
              signalStrength: 'high',
            },
          ],
          valueReference: '<REDACTED_ADDRESS>',
          isMandatory: true,
        };
      }
    }

    // General semantic address field
    if (hasAddressContext && context?.element) {
      return {
        isValid: true,
        category: 'ADDRESS',
        specificSubtype: 'ADDRESS',
        confidence: 0.90,
        reason: 'Semantic address field or container identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'address',
            matchedRule: 'address_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_ADDRESS>',
        isMandatory: true,
      };
    }

    return null;
  },
};
