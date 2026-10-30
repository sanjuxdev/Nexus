import type { BBox } from '../../../contracts/ts/common.js';
import type { OcrToken } from '../../../contracts/ts/vision.js';
import type { PiiCandidate, PiiSignalEvidence } from './types.js';
import { indianPiiRegistry } from '../indian-pii-registry.js';
import { groupTokensIntoLines, reconstructTextWithSpacing } from '../../vision/ocr-processor.js';

/**
 * Document Field Detector
 * 
 * Processes OCR-extracted text from images/documents to identify multiple
 * distinct PII fields within a single visual element (e.g., an ID card, form,
 * bank statement, or scanned document).
 * 
 * Unlike region-level detection which treats an entire image as one unit,
 * this detector:
 * - Groups OCR tokens into semantic lines and fields
 * - Identifies individual PII items per line (e.g., "PAN: ABCDE1234F")
 * - Returns precise per-field bounding boxes
 * - Supports structured documents (ID cards, forms, statements)
 * 
 * This solves the "missing fields" problem where a PAN card image was
 * detected only as "one face" instead of detecting PAN number, name, DOB,
 * father's name, signature, and photo separately.
 */

export interface DocumentField {
  fieldType: string; // e.g., 'PAN', 'AADHAAR', 'NAME', 'DOB', 'PHOTO'
  detectedValue: string;
  bbox: BBox; // Precise bounding box for this field
  confidence: number;
  tokens: OcrToken[]; // Source OCR tokens that comprise this field
  category: string; // PiiType category
  evidence: PiiSignalEvidence[];
}

export interface DocumentAnalysisResult {
  fields: DocumentField[];
  documentType: 'ID_CARD' | 'FORM' | 'BANK_STATEMENT' | 'CERTIFICATE' | 'UNKNOWN';
  confidence: number;
  fullTextExtracted: string;
}

/**
 * Label keywords that indicate structured document field names
 */
const FIELD_LABEL_PATTERNS = {
  PAN: /\b(?:pan|permanent\s+account|pan\s*card|pan\s*no|pan\s*number)\b/i,
  AADHAAR: /\b(?:aadhaar|aadhar|uid|uidai|aadhaar\s*no|aadhaar\s*number)\b/i,
  NAME: /\b(?:name|full\s*name|card\s*holder|holder\s*name|applicant)\b/i,
  FATHER_NAME: /\b(?:father|father's\s*name|father\s*name|guardian)\b/i,
  DOB: /\b(?:dob|date\s*of\s*birth|birth\s*date|born|d\.o\.b)\b/i,
  ADDRESS: /\b(?:address|residence|residential|location|city|state|pin|pincode)\b/i,
  PHONE: /\b(?:phone|mobile|contact|tel|telephone)\b/i,
  EMAIL: /\b(?:email|e-mail|mail)\b/i,
  SIGNATURE: /\b(?:signature|sign|signed)\b/i,
};

/**
 * Detect structured document type from OCR token patterns
 */
function detectDocumentType(lines: OcrToken[][]): 'ID_CARD' | 'FORM' | 'BANK_STATEMENT' | 'CERTIFICATE' | 'UNKNOWN' {
  const fullText = lines.map(line => line.map(t => t.text).join(' ')).join(' ').toLowerCase();
  
  // ID Card patterns (PAN, Aadhaar, Passport, Voter ID, Driving Licence)
  if (
    /\b(?:income\s*tax|government\s*of\s*india|permanent\s*account)\b/i.test(fullText) ||
    /\b(?:uidai|unique\s*identification)\b/i.test(fullText) ||
    /\b(?:driving\s*licence|passport|voter\s*id|epic)\b/i.test(fullText)
  ) {
    return 'ID_CARD';
  }
  
  // Bank Statement patterns
  if (
    /\b(?:account\s*statement|bank\s*statement|transaction|ifsc|account\s*number|balance)\b/i.test(fullText)
  ) {
    return 'BANK_STATEMENT';
  }
  
  // Certificate patterns
  if (
    /\b(?:certificate|certify|awarded|issued|graduation|degree|diploma)\b/i.test(fullText)
  ) {
    return 'CERTIFICATE';
  }
  
  // Form patterns (application, registration, enrollment)
  if (
    /\b(?:application|form|registration|enrollment|submit|applicant)\b/i.test(fullText) &&
    lines.length > 5 // Forms typically have multiple fields
  ) {
    return 'FORM';
  }
  
  return 'UNKNOWN';
}

/**
 * Extract a specific labeled field from OCR tokens.
 * Example: "PAN: ABCDE1234F" → Extract "ABCDE1234F" with its bounding box
 */
function extractLabeledField(
  line: OcrToken[],
  labelPattern: RegExp,
  valueExtractor: (text: string) => string | null
): DocumentField | null {
  const lineText = line.map(t => t.text).join(' ');
  
  if (!labelPattern.test(lineText)) {
    return null;
  }
  
  // Try to find the value part after the label
  // Common patterns:
  // - "PAN: ABCDE1234F"
  // - "PAN ABCDE1234F"
  // - "PAN No: ABCDE1234F"
  
  const colonSplit = lineText.split(/[:：\-]/); // Support colon, Chinese colon, dash
  let candidateValue = colonSplit.length > 1 ? colonSplit.slice(1).join('').trim() : lineText;
  
  // Extract the actual PII value using the detector's logic
  const extractedValue = valueExtractor(candidateValue);
  
  if (!extractedValue) {
    return null;
  }
  
  // Find tokens that contain the extracted value
  const relevantTokens: OcrToken[] = [];
  let accumulatedText = '';
  
  for (const token of line) {
    accumulatedText += token.text;
    if (extractedValue.includes(token.text.trim())) {
      relevantTokens.push(token);
    }
    if (accumulatedText.includes(extractedValue)) {
      break;
    }
  }
  
  if (relevantTokens.length === 0) {
    relevantTokens.push(...line); // Fallback: use entire line
  }
  
  // Compute bounding box that encompasses all relevant tokens
  const bbox = computeBoundingBox(relevantTokens);
  
  return {
    fieldType: 'LABELED_FIELD',
    detectedValue: extractedValue,
    bbox,
    confidence: 0.9, // High confidence for labeled fields
    tokens: relevantTokens,
    category: 'GOV_ID', // Will be overridden by specific detector
    evidence: [{
      field: 'label',
      matchedValue: lineText,
      matchedRule: 'labeled_field_extraction',
      signalStrength: 'high',
    }],
  };
}

/**
 * Compute a tight bounding box around a set of OCR tokens
 */
function computeBoundingBox(tokens: OcrToken[]): BBox {
  if (tokens.length === 0) {
    return [0, 0, 0, 0];
  }
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  for (const token of tokens) {
    const [x, y, w, h] = token.bbox;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  
  return [minX, minY, maxX - minX, maxY - minY];
}

/**
 * Analyze OCR tokens from a document/image to extract multiple distinct PII fields.
 * 
 * @param ocrTokens - OCR tokens extracted from the image
 * @param imageBBox - Bounding box of the source image element (for face detection correlation)
 * @returns Detected document fields with precise bounding boxes
 */
export function analyzeDocumentFields(
  ocrTokens: OcrToken[],
  imageBBox: BBox
): DocumentAnalysisResult {
  const fields: DocumentField[] = [];
  
  if (!ocrTokens || ocrTokens.length === 0) {
    return {
      fields: [],
      documentType: 'UNKNOWN',
      confidence: 0,
      fullTextExtracted: '',
    };
  }
  
  // Group tokens into logical lines
  const lines = groupTokensIntoLines(ocrTokens, 10);
  const fullText = reconstructTextWithSpacing(ocrTokens);
  
  // Detect document type
  const documentType = detectDocumentType(lines);
  
  // Process each line for PII patterns
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const lineText = line.map(t => t.text).join(' ');
    
    // Skip very short lines (likely noise)
    if (lineText.trim().length < 3) {
      continue;
    }
    
    // Attempt labeled field extraction for ID cards
    if (documentType === 'ID_CARD') {
      // Try PAN extraction
      const panField = extractLabeledField(
        line,
        FIELD_LABEL_PATTERNS.PAN,
        (text) => {
          const match = text.match(/\b[A-Z]{5}\d{4}[A-Z]\b/);
          return match ? match[0] : null;
        }
      );
      if (panField) {
        panField.fieldType = 'PAN';
        panField.category = 'GOV_ID';
        fields.push(panField);
        continue;
      }
      
      // Try Aadhaar extraction
      const aadhaarField = extractLabeledField(
        line,
        FIELD_LABEL_PATTERNS.AADHAAR,
        (text) => {
          const match = text.match(/\b[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}\b/);
          return match ? match[0] : null;
        }
      );
      if (aadhaarField) {
        aadhaarField.fieldType = 'AADHAAR';
        aadhaarField.category = 'GOV_ID';
        fields.push(aadhaarField);
        continue;
      }
      
      // Try name extraction
      if (FIELD_LABEL_PATTERNS.NAME.test(lineText) && !FIELD_LABEL_PATTERNS.FATHER_NAME.test(lineText)) {
        // Find tokens after the label
        let foundLabel = false;
        const nameTokens: OcrToken[] = [];
        
        for (const token of line) {
          if (FIELD_LABEL_PATTERNS.NAME.test(token.text)) {
            foundLabel = true;
            continue; // Skip the label itself
          }
          if (foundLabel && token.text.trim().length > 0 && !/^[:\-]$/.test(token.text)) {
            nameTokens.push(token);
          }
        }
        
        if (nameTokens.length > 0) {
          fields.push({
            fieldType: 'NAME',
            detectedValue: nameTokens.map(t => t.text).join(' '),
            bbox: computeBoundingBox(nameTokens),
            confidence: 0.85,
            tokens: nameTokens,
            category: 'PERSON',
            evidence: [{
              field: 'label',
              matchedValue: 'name',
              matchedRule: 'name_label_pattern',
              signalStrength: 'high',
            }],
          });
          continue;
        }
      }
      
      // Try father's name extraction
      if (FIELD_LABEL_PATTERNS.FATHER_NAME.test(lineText)) {
        // Find tokens after the label
        let foundLabel = false;
        const fatherNameTokens: OcrToken[] = [];
        
        for (const token of line) {
          if (FIELD_LABEL_PATTERNS.FATHER_NAME.test(token.text) || token.text.toLowerCase() === 'name:') {
            foundLabel = true;
            continue; // Skip the label
          }
          if (foundLabel && token.text.trim().length > 0 && !/^[:\-]$/.test(token.text)) {
            fatherNameTokens.push(token);
          }
        }
        
        if (fatherNameTokens.length > 0) {
          fields.push({
            fieldType: 'FATHER_NAME',
            detectedValue: fatherNameTokens.map(t => t.text).join(' '),
            bbox: computeBoundingBox(fatherNameTokens),
            confidence: 0.85,
            tokens: fatherNameTokens,
            category: 'PERSON',
            evidence: [{
              field: 'label',
              matchedValue: 'father',
              matchedRule: 'father_name_label_pattern',
              signalStrength: 'high',
            }],
          });
          continue;
        }
      }
      
      // Try DOB extraction
      if (FIELD_LABEL_PATTERNS.DOB.test(lineText)) {
        const dobMatch = lineText.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/);
        if (dobMatch) {
          const dobTokens = line.filter(t => dobMatch[0]?.includes(t.text));
          if (dobTokens.length > 0) {
            fields.push({
              fieldType: 'DOB',
              detectedValue: dobMatch[0]!,
              bbox: computeBoundingBox(dobTokens),
              confidence: 0.90,
              tokens: dobTokens,
              category: 'DOB',
              evidence: [{
                field: 'format_rule',
                matchedValue: dobMatch[0]!,
                matchedRule: 'date_format_pattern',
                signalStrength: 'high',
              }],
            });
            continue;
          }
        }
      }
    }
    
    // Fallback: Use the Indian PII Registry to detect unlabeled fields
    const candidates = indianPiiRegistry.detectText(lineText, {
      surroundingText: fullText,
      sourceType: 'OCR',
    });
    
    for (const candidate of candidates) {
      // Skip if we already detected this field type via labeled extraction
      if (fields.some(f => f.fieldType === candidate.specificSubtype)) {
        continue;
      }
      
      fields.push({
        fieldType: candidate.specificSubtype,
        detectedValue: candidate.evidence.find(e => e.matchedValue)?.matchedValue || lineText,
        bbox: candidate.bbox || computeBoundingBox(line),
        confidence: candidate.confidence,
        tokens: line,
        category: candidate.category,
        evidence: candidate.evidence,
      });
    }
  }
  
  const confidence = fields.length > 0
    ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length
    : 0;
  
  return {
    fields,
    documentType,
    confidence,
    fullTextExtracted: fullText,
  };
}

/**
 * Convert document fields to PiiCandidate format for the sanitizer
 */
export function documentFieldsToPiiCandidates(
  analysisResult: DocumentAnalysisResult,
  imageRegionId: string
): PiiCandidate[] {
  return analysisResult.fields.map((field, idx) => ({
    id: `doc_field_${field.fieldType.toLowerCase()}_${imageRegionId}_${idx}`,
    category: field.category as any,
    specificSubtype: field.fieldType,
    confidence: field.confidence,
    sourceElement: {
      dom_id: imageRegionId,
      role: null,
      tag: null,
    },
    reason: `Detected ${field.fieldType} field in document via OCR: "${field.detectedValue}"`,
    evidence: field.evidence,
    bbox: field.bbox,
    valueReference: `<REDACTED_${field.fieldType}>`,
    isMandatory: true,
  }));
}
