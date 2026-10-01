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
 * 1. Person Name Detector
 */
export const personNameDetector: PiiDetector = {
  id: 'person-name-detector',
  category: 'PERSON',
  specificSubtype: 'PERSON',
  priority: 50,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('full name') || sem.includes('first name') || sem.includes('last name') || sem.includes('applicant name') || sem.includes('customer name') || sem.includes('account holder') || sem.includes('beneficiary name')) {
      return true;
    }
    if (context?.element?.input?.autocomplete?.includes('name')) return true;
    return false;
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against non-person entities
    if (/\b(?:file\s*name|product\s*name|brand\s*name|domain\s*name|host\s*name|company\s*name|organization\s*name|class\s*name|tag\s*name|server\s*name|variable\s*name|model\s*name)\b/i.test(sem) ||
        /\b(?:file\s*name|product\s*name|brand\s*name|domain\s*name)\b/i.test(text)) {
      return null;
    }

    const hasExplicitNameContext =
      sem.includes('full name') ||
      sem.includes('first name') ||
      sem.includes('last name') ||
      sem.includes('applicant name') ||
      sem.includes('customer name') ||
      sem.includes('account holder') ||
      sem.includes('beneficiary name') ||
      sem.includes('father\'s name') ||
      sem.includes('mother\'s name') ||
      ['name', 'given-name', 'family-name', 'additional-name'].includes(context?.element?.input?.autocomplete || '');

    if (!hasExplicitNameContext) {
      // Conservative rule: Do NOT guess person names from arbitrary capitalized strings
      return null;
    }

    return {
      isValid: true,
      category: 'PERSON',
      specificSubtype: 'PERSON',
      normalizedValue: text.trim(),
      confidence: 0.90,
      reason: 'Person name confirmed via explicit semantic label or autocomplete attributes',
      evidence: [
        {
          field: 'label',
          matchedValue: 'person_name',
          matchedRule: 'explicit_person_name_context',
          signalStrength: 'high',
        },
      ],
      valueReference: '<REDACTED_NAME>',
      isMandatory: true,
    };
  },
};

/**
 * 2. Date of Birth Detector
 */
export const dateOfBirthDetector: PiiDetector = {
  id: 'dob-detector',
  category: 'DOB',
  specificSubtype: 'DOB',
  priority: 45,

  canHandle(text: string, context?: DetectorContext): boolean {
    const sem = getSemanticKeywords(context);
    if (sem.includes('dob') || sem.includes('date of birth') || sem.includes('birth date') || sem.includes('birthday')) {
      return true;
    }
    if (context?.element?.input?.autocomplete?.includes('bday')) return true;
    return false;
  },

  detect(text: string, context?: DetectorContext): DetectorValidationResult | null {
    const sem = getSemanticKeywords(context);

    // False positive protection against non-birth dates
    if (/\b(?:release\s*date|event\s*date|expiry\s*date|due\s*date|creation\s*date|update\s*date|start\s*date|end\s*date|meeting\s*date|order\s*date)\b/i.test(sem) ||
        /\b(?:release\s*date|event\s*date|expiry\s*date)\b/i.test(text)) {
      return null;
    }

    const hasDobContext =
      sem.includes('dob') ||
      sem.includes('date of birth') ||
      sem.includes('birth date') ||
      sem.includes('birthday') ||
      context?.element?.input?.autocomplete?.includes('bday');

    if (!hasDobContext) {
      // Conservative rule: Never mask arbitrary dates without DOB context
      return null;
    }

    // Match common date patterns: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
    const dateMatch = text.match(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/);

    return {
      isValid: true,
      category: 'DOB',
      specificSubtype: 'DOB',
      normalizedValue: dateMatch ? dateMatch[0] : text.trim(),
      confidence: 0.95,
      reason: 'Date of birth confirmed via birth date semantic context',
      evidence: [
        {
          field: 'label',
          matchedValue: 'date_of_birth',
          matchedRule: 'dob_context_confirmed',
          signalStrength: 'high',
        },
      ],
      valueReference: '<REDACTED_DOB>',
      isMandatory: true,
    };
  },
};
