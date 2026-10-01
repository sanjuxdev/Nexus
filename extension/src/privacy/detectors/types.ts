import type { BBox } from '../../../contracts/ts/common.js';
import type { DomElementInfo } from '../../../contracts/ts/dom.js';
import type { PiiType } from '../../../contracts/ts/privacy.js';

/**
 * Phase 4: Indian PII Detector Registry Types
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
    | 'surrounding_text'
    | 'regex_structure'
    | 'checksum'
    | 'format_rule';
  matchedValue: string;
  matchedRule: string;
  signalStrength: 'high' | 'medium' | 'low';
}

export interface PiiCandidate {
  id: string; // Unique deterministic candidate ID, e.g. `pii_aadhaar_d1`
  category: PiiType;
  specificSubtype: string; // e.g. 'AADHAAR' | 'PAN' | 'VOTER_ID' | 'PASSPORT' | 'DRIVING_LICENCE' | 'IFSC' | 'UPI' | 'CARD'
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
  valueReference: string | null; // Masked replacement token (NEVER raw unmasked PII!)
  isMandatory: boolean;
}

export interface DetectorContext {
  element?: DomElementInfo | null;
  surroundingText?: string;
  formName?: string;
  sourceType?: 'DOM' | 'TEXT' | 'REGION';
}

export interface DetectorValidationResult {
  isValid: boolean;
  category: PiiType;
  specificSubtype: string;
  normalizedValue?: string;
  confidence: number;
  reason: string;
  evidence: PiiSignalEvidence[];
  valueReference: string;
  isMandatory: boolean;
}

export interface PiiDetector {
  id: string; // e.g. 'aadhaar-detector'
  category: PiiType;
  specificSubtype: string;
  priority: number; // Higher number = evaluated earlier in conflict resolution
  canHandle(text: string, context?: DetectorContext): boolean;
  detect(text: string, context?: DetectorContext): DetectorValidationResult | null;
}
