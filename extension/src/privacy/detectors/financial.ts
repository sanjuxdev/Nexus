import type { DetectorContext, DetectorValidationResult, PiiDetector, PiiSignalEvidence } from './types.js';

/**
 * Standard Luhn algorithm (Modulus 10) for payment card checksum verification.
 */
export function validateLuhn(numStr: string): boolean {
  const clean = numStr.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(clean)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function validateIFSC(ifscStr: string): boolean {
  const clean = ifscStr.trim().toUpperCase();
  // Exactly 11 characters: 4 letters + '0' + 6 alphanumeric
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean);
}

const COMMON_UPI_HANDLES = new Set([
  'okhdfcbank', 'okaxis', 'oksbi', 'okicici', 'paytm', 'ybl', 'ibl', 'axl', 'apl',
  'upi', 'barodampay', 'federal', 'kotak', 'indus', 'icici', 'sbi', 'hdfcbank',
]);

export function validateUpiId(upiStr: string): boolean {
  const clean = upiStr.trim().toLowerCase();
  const parts = clean.split('@');
  if (parts.length !== 2) return false;
  const [handle, provider] = parts;
  if (!handle || !provider) return false;
  // Provider should NOT contain a dot (that indicates an email domain like example.com)
  if (provider.includes('.')) return false;
  if (!/^[a-z0-9._-]{2,64}$/.test(handle)) return false;
  if (!/^[a-z0-9]{2,32}$/.test(provider)) return false;
  return true;
}

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
 * 1. Bank Account Number Detector
 */
export const bankAccountDetector: PiiDetector = {
  id: 'bank-account-detector',
  category: 'BANK_ACCOUNT',
  specificSubtype: 'BANK_ACCOUNT',
  priority: 60,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    return sem.includes('account number') || sem.includes('account no') || sem.includes('bank account') || sem.includes('savings account') || sem.includes('current account') || sem.includes('a/c no');
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against non-bank accounts (user account, order, etc.)
    if (/\b(?:user\s*account|google\s*account|login\s*account|email\s*account|social\s*account|github\s*account|order|invoice|tracking|serial)\b/i.test(sem)) {
      return null;
    }

    const hasAccountContext =
      sem.includes('account number') ||
      sem.includes('account no') ||
      sem.includes('bank account') ||
      sem.includes('savings account') ||
      sem.includes('current account') ||
      sem.includes('a/c no');

    if (!hasAccountContext) {
      // Strict rule: Never mask arbitrary 9-18 digit numbers without bank account context
      return null;
    }

    const matches = text.match(/\b\d{9,18}\b/g);
    if (matches) {
      for (const match of matches) {
        return {
          isValid: true,
          category: 'BANK_ACCOUNT',
          specificSubtype: 'BANK_ACCOUNT',
          normalizedValue: match,
          confidence: 0.95,
          reason: `Bank account number (${match}) confirmed via bank account semantic context`,
          evidence: [
            {
              field: 'regex_structure',
              matchedValue: match,
              matchedRule: 'bank_account_9_to_18_digits',
              signalStrength: 'high',
            },
            {
              field: 'label',
              matchedValue: 'account_number',
              matchedRule: 'bank_account_context',
              signalStrength: 'high',
            },
          ],
          valueReference: '<REDACTED_BANK_ACCOUNT>',
          isMandatory: true,
        };
      }
    }

    if (hasAccountContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'BANK_ACCOUNT',
        specificSubtype: 'BANK_ACCOUNT',
        confidence: 0.90,
        reason: 'Semantic bank account input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'account_number',
            matchedRule: 'bank_account_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_BANK_ACCOUNT>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 2. IFSC Code Detector
 */
export const ifscDetector: PiiDetector = {
  id: 'ifsc-detector',
  category: 'IDENTIFIER',
  specificSubtype: 'IFSC',
  priority: 58,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('ifsc') || sem.includes('bank branch') || sem.includes('rtgs') || sem.includes('neft')) return true;
    return /\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);
    const hasContext = sem.includes('ifsc') || sem.includes('bank branch') || sem.includes('rtgs') || sem.includes('neft');

    const matches = text.match(/\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/g);
    if (matches) {
      for (const match of matches) {
        if (validateIFSC(match)) {
          return {
            isValid: true,
            category: 'IDENTIFIER',
            specificSubtype: 'IFSC',
            normalizedValue: match.toUpperCase(),
            confidence: hasContext ? 0.99 : 0.94,
            reason: `Valid 11-character Indian IFSC code with 5th char zero (${match.toUpperCase()})${hasContext ? ' in IFSC context' : ''}`,
            evidence: [
              {
                field: 'format_rule',
                matchedValue: match.toUpperCase(),
                matchedRule: 'ifsc_4letter_zero_6alphanumeric',
                signalStrength: 'high',
              },
            ],
            valueReference: '<REDACTED_IFSC>',
            isMandatory: true,
          };
        }
      }
    }

    if (hasContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'IDENTIFIER',
        specificSubtype: 'IFSC',
        confidence: 0.90,
        reason: 'Semantic IFSC input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'ifsc',
            matchedRule: 'ifsc_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_IFSC>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 3. UPI ID (VPA) Detector
 */
export const upiDetector: PiiDetector = {
  id: 'upi-detector',
  category: 'IDENTIFIER',
  specificSubtype: 'UPI',
  priority: 56,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('upi') || sem.includes('vpa') || sem.includes('bhim')) return true;
    return /\b[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);
    const hasContext = sem.includes('upi') || sem.includes('vpa') || sem.includes('bhim');

    // Look for handles: user@provider where provider has no dot
    const matches = text.match(/\b[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}\b/g);
    if (matches) {
      for (const match of matches) {
        if (validateUpiId(match)) {
          const provider = match.split('@')[1]?.toLowerCase() || '';
          const isKnownProvider = COMMON_UPI_HANDLES.has(provider);

          if (isKnownProvider || hasContext) {
            return {
              isValid: true,
              category: 'IDENTIFIER',
              specificSubtype: 'UPI',
              normalizedValue: match.toLowerCase(),
              confidence: hasContext ? 0.98 : 0.90,
              reason: `Valid UPI ID (${match}) with ${isKnownProvider ? 'recognized PSP handle' : 'UPI context'}`,
              evidence: [
                {
                  field: 'regex_structure',
                  matchedValue: match.toLowerCase(),
                  matchedRule: 'upi_vpa_structure',
                  signalStrength: 'high',
                },
              ],
              valueReference: '<REDACTED_UPI>',
              isMandatory: true,
            };
          }
        }
      }
    }

    if (hasContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'IDENTIFIER',
        specificSubtype: 'UPI',
        confidence: 0.90,
        reason: 'Semantic UPI input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'upi',
            matchedRule: 'upi_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_UPI>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 4. Payment Card Detector (Credit / Debit / Prepaid)
 */
export const cardDetector: PiiDetector = {
  id: 'card-detector',
  category: 'CARD',
  specificSubtype: 'CARD',
  priority: 55,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('credit card') || sem.includes('debit card') || sem.includes('card number') || sem.includes('cvv') || sem.includes('cvc')) {
      return true;
    }
    if (context?.element?.input?.autocomplete?.includes('cc-')) return true;
    return /\b(?:\d{4}[-\s]?){3}\d{1,4}\b/.test(text) || /\b\d{13,19}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against non-payment card terms
    if (/\b(?:cardboard|wildcard|postcard|greeting\s*card|sim\s*card|sd\s*card|graphics\s*card|sound\s*card)\b/i.test(sem) ||
        /\b(?:cardboard|wildcard|postcard)\b/i.test(text) ||
        /\b(?:telemetry|sequence|metric|counter|timestamp|order|invoice|tracking|serial)\b/i.test(sem)) {
      return null;
    }

    const hasCardContext =
      sem.includes('credit card') ||
      sem.includes('debit card') ||
      sem.includes('card number') ||
      sem.includes('payment') ||
      sem.includes('visa') ||
      sem.includes('mastercard') ||
      sem.includes('amex') ||
      sem.includes('rupay') ||
      sem.includes('cvv') ||
      sem.includes('cvc') ||
      Boolean(context?.element?.input?.autocomplete?.includes('cc-'));

    if (!hasCardContext) {
      // Conservative rule: Do not classify arbitrary 13-19 digit numbers as payment card without card/payment context
      return null;
    }

    // Extract potential card sequences (13 to 19 digits)
    const matches = text.match(/\b(?:\d{4}[-\s]?){3}\d{1,4}\b/g) || text.match(/\b\d{13,19}\b/g);
    if (matches) {
      for (const rawMatch of matches) {
        const clean = rawMatch.replace(/[\s-]/g, '');
        if (validateLuhn(clean)) {
          return {
            isValid: true,
            category: 'CARD',
            specificSubtype: 'CARD',
            normalizedValue: clean,
            confidence: 1.0,
            reason: `Valid payment card number passing Luhn algorithm (${rawMatch}) with card context`,
            evidence: [
              {
                field: 'checksum',
                matchedValue: rawMatch,
                matchedRule: 'luhn_mod10_valid',
                signalStrength: 'high',
              },
            ],
            valueReference: '<REDACTED_CARD>',
            isMandatory: true,
          };
        }
      }
    }

    if (hasCardContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'CARD',
        specificSubtype: 'CARD',
        confidence: 0.95,
        reason: 'Semantic payment card input field identified',
        evidence: [
          {
            field: 'autocomplete',
            matchedValue: context.element.input.autocomplete || 'cc-number',
            matchedRule: 'card_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_CARD>',
        isMandatory: true,
      };
    }

    return null;
  },
};
