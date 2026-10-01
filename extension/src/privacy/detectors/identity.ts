import type { DetectorContext, DetectorValidationResult, PiiDetector, PiiSignalEvidence } from './types.js';

/**
 * Verhoeff checksum algorithm for Indian Aadhaar validation.
 */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function validateAadhaarVerhoeff(aadhaarStr: string): boolean {
  const clean = aadhaarStr.replace(/[\s-]/g, '');
  if (!/^[2-9]\d{11}$/.test(clean)) return false;

  let c = 0;
  const digits = clean.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i];
    if (digit === undefined) return false;
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![digit]!]!;
  }
  return c === 0;
}

export function validateIndianPAN(panStr: string): boolean {
  const clean = panStr.trim().toUpperCase();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(clean)) return false;
  // 4th character must be one of the recognized PAN entity types
  const validEntityTypes = new Set(['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G']);
  return validEntityTypes.has(clean[3]!);
}

export function validateVoterId(epicStr: string): boolean {
  const clean = epicStr.trim().toUpperCase();
  return /^[A-Z]{3}\d{7}$/.test(clean);
}

export function validateIndianPassport(passportStr: string): boolean {
  const clean = passportStr.trim().toUpperCase();
  return /^[A-PR-WY]\d{7}$/.test(clean);
}

const INDIAN_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HR',
  'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD',
  'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK', 'UP', 'WB',
]);

export function validateDrivingLicence(dlStr: string): boolean {
  const clean = dlStr.replace(/[\s-]/g, '').toUpperCase();
  if (clean.length < 15 || clean.length > 16) return false;
  const state = clean.slice(0, 2);
  if (!INDIAN_STATE_CODES.has(state)) return false;
  const remainingDigits = clean.slice(2);
  if (!/^\d{13,14}$/.test(remainingDigits)) return false;
  const year = parseInt(remainingDigits.slice(2, 6), 10);
  const currentYear = new Date().getFullYear();
  return year >= 1950 && year <= currentYear + 1;
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
 * 1. Aadhaar Detector
 */
export const aadhaarDetector: PiiDetector = {
  id: 'aadhaar-detector',
  category: 'GOV_ID',
  specificSubtype: 'AADHAAR',
  priority: 100,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('aadhaar') || sem.includes('aadhar') || sem.includes('uidai')) return true;
    if (context?.element?.input?.autocomplete?.includes('aadhaar')) return true;
    return false;
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against non-Aadhaar contexts (order numbers, tracking IDs, etc.)
    if (/\b(?:order|invoice|tracking|serial|shipment|booking|receipt|transaction\s*id|product\s*id|sku|ticket\s*number)\b/i.test(sem) ||
        /\b(?:order\s*#?|invoice\s*#?|tracking\s*#?)\b/i.test(text)) {
      return null;
    }

    const hasAadhaarContext = sem.includes('aadhaar') || sem.includes('aadhar') || sem.includes('uidai') ||
      Boolean(context?.element?.input?.autocomplete?.includes('aadhaar'));

    if (!hasAadhaarContext) {
      // Prompt requirement: A random 12-digit number ≠ automatically Aadhaar
      return null;
    }

    const aadhaarMatches = text.match(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g);

    if (aadhaarMatches) {
      for (const match of aadhaarMatches) {
        if (validateAadhaarVerhoeff(match)) {
          const evidence: PiiSignalEvidence[] = [
            {
              field: 'checksum',
              matchedValue: match,
              matchedRule: 'verhoeff_d5_valid',
              signalStrength: 'high',
            },
            {
              field: 'label',
              matchedValue: 'aadhaar',
              matchedRule: 'aadhaar_semantic_context',
              signalStrength: 'high',
            },
          ];

          return {
            isValid: true,
            category: 'GOV_ID',
            specificSubtype: 'AADHAAR',
            normalizedValue: match.replace(/[\s-]/g, ''),
            confidence: 1.0,
            reason: `Valid Aadhaar number with Verhoeff D5 checksum and semantic context (${match})`,
            evidence,
            valueReference: '<REDACTED_AADHAAR>',
            isMandatory: true,
          };
        }
      }
    }

    // Context-only element detection (form input with placeholder/label for Aadhaar)
    if (hasAadhaarContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'GOV_ID',
        specificSubtype: 'AADHAAR',
        confidence: 0.95,
        reason: 'Semantic Aadhaar input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'aadhaar',
            matchedRule: 'aadhaar_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_AADHAAR>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 2. PAN Detector
 */
export const panDetector: PiiDetector = {
  id: 'pan-detector',
  category: 'GOV_ID',
  specificSubtype: 'PAN',
  priority: 95,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('pan card') || sem.includes('pan number') || sem.includes('permanent account number') || /\bpan\b/.test(sem)) {
      return true;
    }
    return /\b[A-Za-z]{5}\d{4}[A-Za-z]\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);
    // False positive protection against non-PAN words
    if (/\b(?:panoramic|pantry|japan|company\s*panel|pan\s*handle|frying\s*pan|span|steel\s*pan)\b/i.test(sem) ||
        /\b(?:panoramic|pantry|japan|span)\b/i.test(text) ||
        /\b(?:order|invoice|tracking|serial|shipment|booking|receipt|sku|ticket)\b/i.test(sem)) {
      return null;
    }

    const hasPanContext =
      sem.includes('pan card') ||
      sem.includes('pan number') ||
      sem.includes('permanent account number') ||
      /\bpan\b/.test(sem);

    const panMatches = text.match(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g);
    if (panMatches) {
      for (const match of panMatches) {
        if (validateIndianPAN(match)) {
          const evidence: PiiSignalEvidence[] = [
            {
              field: 'format_rule',
              matchedValue: match.toUpperCase(),
              matchedRule: `pan_entity_type_${match.toUpperCase()[3]}`,
              signalStrength: 'high',
            },
          ];
          if (hasPanContext) {
            evidence.push({
              field: 'label',
              matchedValue: 'pan',
              matchedRule: 'pan_semantic_context',
              signalStrength: 'high',
            });
          }

          return {
            isValid: true,
            category: 'GOV_ID',
            specificSubtype: 'PAN',
            normalizedValue: match.toUpperCase(),
            confidence: hasPanContext ? 1.0 : 0.88,
            reason: `Valid Indian PAN structure with entity type [${match.toUpperCase()[3]}]${hasPanContext ? ' and semantic context' : ''}`,
            evidence,
            valueReference: '<REDACTED_PAN>',
            isMandatory: true,
          };
        }
      }
    }

    if (hasPanContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'GOV_ID',
        specificSubtype: 'PAN',
        confidence: 0.90,
        reason: 'Semantic PAN input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'pan',
            matchedRule: 'pan_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_PAN>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 3. Voter ID / EPIC Detector
 */
export const voterIdDetector: PiiDetector = {
  id: 'voter-id-detector',
  category: 'GOV_ID',
  specificSubtype: 'VOTER_ID',
  priority: 90,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('voter') || sem.includes('epic') || sem.includes('elector') || sem.includes('election card')) {
      return true;
    }
    return /\b[A-Za-z]{3}\d{7}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);
    const hasContext = sem.includes('voter') || sem.includes('epic') || sem.includes('elector') || sem.includes('election card');

    const matches = text.match(/\b[A-Za-z]{3}\d{7}\b/g);
    if (matches) {
      for (const match of matches) {
        if (validateVoterId(match)) {
          // Require context or high specificity to avoid false positives with arbitrary 10-char order codes
          const confidence = hasContext ? 0.95 : 0.60;
          if (confidence >= 0.70) {
            return {
              isValid: true,
              category: 'GOV_ID',
              specificSubtype: 'VOTER_ID',
              normalizedValue: match.toUpperCase(),
              confidence,
              reason: 'Valid Voter ID / EPIC structure with supporting context',
              evidence: [
                {
                  field: 'regex_structure',
                  matchedValue: match.toUpperCase(),
                  matchedRule: 'epic_3letter_7digit',
                  signalStrength: 'high',
                },
              ],
              valueReference: '<REDACTED_VOTER_ID>',
              isMandatory: true,
            };
          }
        }
      }
    }

    if (hasContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'GOV_ID',
        specificSubtype: 'VOTER_ID',
        confidence: 0.90,
        reason: 'Semantic Voter ID input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'voter_id',
            matchedRule: 'voter_id_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_VOTER_ID>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 4. Passport Detector
 */
export const passportDetector: PiiDetector = {
  id: 'passport-detector',
  category: 'GOV_ID',
  specificSubtype: 'PASSPORT',
  priority: 85,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('passport')) return true;
    return /\b[A-PR-WYa-pr-wy]\d{7}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);
    const hasContext = sem.includes('passport');

    const matches = text.match(/\b[A-PR-WYa-pr-wy]\d{7}\b/g);
    if (matches) {
      for (const match of matches) {
        if (validateIndianPassport(match)) {
          // Passport format (1 letter + 7 digits) requires semantic context to avoid matching product SKUs / part numbers
          if (hasContext) {
            return {
              isValid: true,
              category: 'GOV_ID',
              specificSubtype: 'PASSPORT',
              normalizedValue: match.toUpperCase(),
              confidence: 0.95,
              reason: 'Valid Indian Passport number with supporting semantic context',
              evidence: [
                {
                  field: 'format_rule',
                  matchedValue: match.toUpperCase(),
                  matchedRule: 'indian_passport_1letter_7digit',
                  signalStrength: 'high',
                },
                {
                  field: 'label',
                  matchedValue: 'passport',
                  matchedRule: 'passport_context',
                  signalStrength: 'high',
                },
              ],
              valueReference: '<REDACTED_PASSPORT>',
              isMandatory: true,
            };
          }
        }
      }
    }

    if (hasContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'GOV_ID',
        specificSubtype: 'PASSPORT',
        confidence: 0.90,
        reason: 'Semantic Passport input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'passport',
            matchedRule: 'passport_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_PASSPORT>',
        isMandatory: true,
      };
    }

    return null;
  },
};

/**
 * 5. Driving Licence Detector
 */
export const drivingLicenceDetector: PiiDetector = {
  id: 'driving-licence-detector',
  category: 'GOV_ID',
  specificSubtype: 'DRIVING_LICENCE',
  priority: 80,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('driving licence') || sem.includes('driving license') || sem.includes('dl no') || sem.includes('dl number')) {
      return true;
    }
    return /\b[A-Za-z]{2}[-\s]?\d{2}[-\s]?(?:19|20)\d{2}[-\s]?\d{7}\b/.test(text);
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);
    const hasContext = sem.includes('driving licence') || sem.includes('driving license') || sem.includes('dl no') || sem.includes('dl number');

    const matches = text.match(/\b[A-Za-z]{2}[-\s]?\d{2}[-\s]?(?:19|20)\d{2}[-\s]?\d{7}\b/g);
    if (matches) {
      for (const match of matches) {
        if (validateDrivingLicence(match)) {
          return {
            isValid: true,
            category: 'GOV_ID',
            specificSubtype: 'DRIVING_LICENCE',
            normalizedValue: match.replace(/[\s-]/g, '').toUpperCase(),
            confidence: hasContext ? 0.98 : 0.88,
            reason: `Valid Indian Driving Licence number with state code and valid year${hasContext ? ' in DL context' : ''}`,
            evidence: [
              {
                field: 'format_rule',
                matchedValue: match.toUpperCase(),
                matchedRule: 'sarathi_dl_format',
                signalStrength: 'high',
              },
            ],
            valueReference: '<REDACTED_DRIVING_LICENCE>',
            isMandatory: true,
          };
        }
      }
    }

    if (hasContext && context?.element?.input) {
      return {
        isValid: true,
        category: 'GOV_ID',
        specificSubtype: 'DRIVING_LICENCE',
        confidence: 0.90,
        reason: 'Semantic Driving Licence input field identified',
        evidence: [
          {
            field: 'label',
            matchedValue: 'driving_licence',
            matchedRule: 'dl_field_context',
            signalStrength: 'high',
          },
        ],
        valueReference: '<REDACTED_DRIVING_LICENCE>',
        isMandatory: true,
      };
    }

    return null;
  },
};
