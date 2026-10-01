import type { DomElementInfo } from '../../contracts/ts/dom.js';
import type {
  DetectorContext,
  DetectorValidationResult,
  PiiCandidate,
  PiiDetector,
} from './detectors/types.js';

// Identity detectors
import {
  aadhaarDetector,
  panDetector,
  voterIdDetector,
  passportDetector,
  drivingLicenceDetector,
} from './detectors/identity.js';

// Contact detectors
import {
  indianPhoneDetector,
  emailDetector,
  addressDetector,
} from './detectors/contact.js';

// Financial detectors
import {
  bankAccountDetector,
  ifscDetector,
  upiDetector,
  cardDetector,
} from './detectors/financial.js';

// Personal detectors
import {
  personNameDetector,
  dateOfBirthDetector,
} from './detectors/personal.js';

/**
 * Phase 4: Indian PII Detector Registry
 * 
 * Extensible, high-performance registry coordinating modular Indian personal-data
 * detectors with structural validation, semantic context fusion, false-positive protection,
 * and deterministic candidate deduplication.
 */
export class IndianPiiRegistry {
  private detectors: PiiDetector[] = [];

  constructor() {
    this.registerDefaults();
  }

  /**
   * Registers a new PII detector into the registry.
   */
  public register(detector: PiiDetector): void {
    // Prevent duplicate registrations
    this.detectors = this.detectors.filter((d) => d.id !== detector.id);
    this.detectors.push(detector);
    // Sort by priority descending (highest priority first)
    this.detectors.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Retrieves a detector by ID.
   */
  public getDetector(id: string): PiiDetector | undefined {
    return this.detectors.find((d) => d.id === id);
  }

  /**
   * Returns all registered detectors.
   */
  public getAllDetectors(): PiiDetector[] {
    return [...this.detectors];
  }

  /**
   * Registers default Indian PII detectors in priority order.
   */
  private registerDefaults(): void {
    // Identity (Priorities 100 - 80)
    this.register(aadhaarDetector);
    this.register(panDetector);
    this.register(voterIdDetector);
    this.register(passportDetector);
    this.register(drivingLicenceDetector);

    // Contact (Priorities 75 - 65)
    this.register(indianPhoneDetector);
    this.register(emailDetector);
    this.register(addressDetector);

    // Financial (Priorities 60 - 55)
    this.register(bankAccountDetector);
    this.register(ifscDetector);
    this.register(upiDetector);
    this.register(cardDetector);

    // Personal (Priorities 50 - 45)
    this.register(personNameDetector);
    this.register(dateOfBirthDetector);
  }

  /**
   * Evaluates whether a text represents a common non-PII token
   * (e.g. UUID, hex string, IP address, order number, timestamp).
   */
  private isGenericNonPiiToken(text: string): boolean {
    const trimmed = text.trim();
    // UUID v4
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
    // Hex string (e.g. git commit hash or checksum)
    if (/^[0-9a-f]{32,64}$/i.test(trimmed)) return true;
    // IPv4 address
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(trimmed)) return true;
    // ISO 8601 Timestamp
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) return true;
    // Order, tracking, invoice, SKU, reference tokens (e.g. ORD-9876543210, TRACK-1234567890)
    if (/^(?:ord|order|track|tracking|inv|invoice|ref|sku|item|serial)[\s#_-][a-z0-9_-]+$/i.test(trimmed)) return true;

    return false;
  }

  /**
   * Classifies a DOM element using indexed detector selection.
   * Merges multiple matching signals and deduplicates candidates deterministically.
   */
  public detectElement(el: DomElementInfo, context?: DetectorContext): PiiCandidate | null {
    if (!el) return null;

    // Filter action controls (buttons, links) unless they contain direct PII
    const role = (el.role || '').toLowerCase();
    const tag = (el.tag || '').toLowerCase();
    const type = (el.input?.type || '').toLowerCase();

    if (type === 'button' || type === 'submit' || type === 'reset') return null;
    if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') return null;
    if (tag === 'button' || tag === 'a') return null;

    // Combine element text and value for candidate inspection
    const contentToScan = [
      el.input?.value,
      el.text,
      el.name,
      el.label,
      el.input?.placeholder,
      context?.surroundingText,
    ]
      .filter(Boolean)
      .join(' ');

    const detContext: DetectorContext = {
      element: el,
      surroundingText: context?.surroundingText || el.text,
      formName: el.form_id || context?.formName,
      sourceType: 'DOM',
    };

    const results: DetectorValidationResult[] = [];

    // Run indexed detectors that canHandle the content/element
    for (const detector of this.detectors) {
      if (detector.canHandle(contentToScan, detContext)) {
        const res = detector.detect(contentToScan, detContext);
        if (res && res.isValid && res.confidence >= 0.70) {
          results.push(res);
        }
      }
    }

    if (results.length === 0) {
      return null;
    }

    // Sort by confidence descending, then by priority
    results.sort((a, b) => b.confidence - a.confidence);
    const topResult = results[0]!;

    // Consolidate evidence from all corroborating results
    const combinedEvidence = results.flatMap((r) => r.evidence);

    const subtype = topResult.specificSubtype || topResult.category;
    const domId = el.dom_id || el.element_id || 'elem';

    return {
      id: `pii_${subtype.toLowerCase()}_${domId}`,
      category: topResult.category,
      specificSubtype: subtype,
      confidence: topResult.confidence,
      sourceElement: {
        dom_id: el.dom_id,
        element_id: el.element_id,
        element_name: el.element_name || el.input?.name,
        role: el.role,
        tag: el.tag,
        stable_selector: el.stable_selector,
      },
      reason: topResult.reason,
      evidence: combinedEvidence,
      bbox: el.bbox,
      valueReference: topResult.valueReference,
      isMandatory: topResult.isMandatory,
    };
  }

  /**
   * Scans text directly for Indian PII patterns with false positive filtering.
   */
  public detectText(text: string, context?: DetectorContext): PiiCandidate[] {
    if (!text || typeof text !== 'string') return [];
    if (this.isGenericNonPiiToken(text)) return [];

    const candidates: PiiCandidate[] = [];
    const seenCategories = new Set<string>();

    for (const detector of this.detectors) {
      if (detector.canHandle(text, context)) {
        const res = detector.detect(text, context);
        if (res && res.isValid && res.confidence >= 0.70) {
          if (!seenCategories.has(res.specificSubtype)) {
            seenCategories.add(res.specificSubtype);
            candidates.push({
              id: `pii_${res.specificSubtype.toLowerCase()}_text`,
              category: res.category,
              specificSubtype: res.specificSubtype,
              confidence: res.confidence,
              sourceElement: {
                dom_id: context?.element?.dom_id,
                element_id: context?.element?.element_id,
                role: context?.element?.role,
                tag: context?.element?.tag,
              },
              reason: res.reason,
              evidence: res.evidence,
              bbox: context?.element?.bbox || null,
              valueReference: res.valueReference,
              isMandatory: res.isMandatory,
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Classifies an entire set of elements with deduplication.
   */
  public detectAll(elements: DomElementInfo[], context?: DetectorContext): PiiCandidate[] {
    if (!elements || !Array.isArray(elements)) return [];

    const candidates: PiiCandidate[] = [];
    const seenIds = new Set<string>();

    for (const el of elements) {
      const cand = this.detectElement(el, context);
      if (cand && !seenIds.has(cand.id)) {
        seenIds.add(cand.id);
        candidates.push(cand);
      }
    }

    return candidates;
  }
}

// Global registry instance
export const indianPiiRegistry = new IndianPiiRegistry();
