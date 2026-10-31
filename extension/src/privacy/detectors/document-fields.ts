import type { BBox, OcrToken } from '@contracts/index.js';
import type { PiiCandidate, PiiSignalEvidence } from './types.js';
import { indianPiiRegistry } from '../indian-pii-registry.js';
import { validateIndianPAN, normalizePanForOcr } from './identity.js';

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
 * Group OCR tokens into logical text lines based on vertical proximity.
 */
export function groupTokensIntoLines(tokens: OcrToken[], lineHeightThreshold = 10): OcrToken[][] {
  if (tokens.length === 0) return [];
  
  // Sort by Y position first, then X position
  const sorted = [...tokens].sort((a, b) => {
    const yDiff = a.bbox[1] - b.bbox[1];
    if (Math.abs(yDiff) > lineHeightThreshold) return yDiff;
    return a.bbox[0] - b.bbox[0];
  });
  
  const lines: OcrToken[][] = [];
  let currentLine: OcrToken[] = [sorted[0]!];
  
  for (let i = 1; i < sorted.length; i++) {
    const token = sorted[i]!;
    const prevToken = sorted[i - 1]!;
    
    const yDiff = Math.abs(token.bbox[1] - prevToken.bbox[1]);
    
    if (yDiff <= lineHeightThreshold) {
      currentLine.push(token);
    } else {
      lines.push(currentLine);
      currentLine = [token];
    }
  }
  
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  for (const line of lines) {
    line.sort((a, b) => a.bbox[0] - b.bbox[0]);
  }
  
  return lines;
}

/**
 * Reconstruct full text with original spacing from OCR tokens.
 */
export function reconstructTextWithSpacing(tokens: OcrToken[]): string {
  const lines = groupTokensIntoLines(tokens);
  return lines.map(line => line.map(t => t.text).join(' ')).join('\n');
}

/**
 * Label keywords that indicate structured document field names
 */
const FIELD_LABEL_PATTERNS = {
  PAN: /\b(?:pan|permanent\s+account|pan\s*card|pan\s*no|pan\s*number)\b/i,
  AADHAAR: /\b(?:aadhaar|aadhar|uid|uidai|aadhaar\s*no|aadhaar\s*number)\b/i,
  NAME: /\b(?:name|full\s*name|card\s*holder|holder\s*name|applicant|nam|nawe|nane|nan)\b/i,
  FATHER_NAME: /\b(?:father|father's\s*name|father\s*name|guardian|faber|fater|fether)\b/i,
  DOB: /\b(?:dob|date\s*of\s*birth|birth\s*date|born|d\.o\.b|dare\s*of\s*birth)\b/i,
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
  
  if (
    /\b(?:income\s*tax|government\s*of\s*india|govt\s*of\s*india|permanent\s*account|pan\s*card|pan\s*no|pan\s*number|incometax|aayakar)\b/i.test(fullText) ||
    /\b(?:father'?s?\s*name|date\s*of\s*birth)\b/i.test(fullText) ||
    /\b(?:uidai|unique\s*identification)\b/i.test(fullText) ||
    /\b(?:driving\s*licence|passport|voter\s*id|epic)\b/i.test(fullText) ||
    /\b[a-z]{3}[pchfatbljg][a-z][\s\-]?[0-9oil]{4}[\s\-]?[a-z]\b/i.test(fullText) ||
    /\b[a-z]{5}[\s\-]?[0-9oil]{4}[\s\-]?[a-z]\b/i.test(fullText)
  ) {
    return 'ID_CARD';
  }
  
  if (
    /\b(?:account\s*statement|bank\s*statement|transaction|ifsc|account\s*number|balance)\b/i.test(fullText)
  ) {
    return 'BANK_STATEMENT';
  }
  
  if (
    /\b(?:certificate|certify|awarded|issued|graduation|degree|diploma)\b/i.test(fullText)
  ) {
    return 'CERTIFICATE';
  }
  
  if (
    /\b(?:application|form|registration|enrollment|submit|applicant)\b/i.test(fullText) &&
    lines.length > 5
  ) {
    return 'FORM';
  }
  
  return 'UNKNOWN';
}

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
  
  const lines = groupTokensIntoLines(ocrTokens, 10);
  const fullText = reconstructTextWithSpacing(ocrTokens);
  const documentType = detectDocumentType(lines);
  
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const lineText = line.map(t => t.text).join(' ');
    
    if (lineText.trim().length < 3) {
      continue;
    }
    
    if (documentType === 'ID_CARD' || documentType === 'UNKNOWN') {
      // 1. Direct PAN number extraction (handles spaces/hyphens and OCR digit variations)
      const directPanMatch = lineText.match(/\b([A-Z]{3}[PCHFATBLJG][A-Z][\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])\b/i) ||
                             lineText.match(/\b([A-Z]{5}[\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])\b/i) ||
                             lineText.match(/([A-Z]{3}[PCHFATBLJG][A-Z][\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])/i);
      if (directPanMatch) {
        const panVal = normalizePanForOcr(directPanMatch[1] || directPanMatch[0]);
        if (validateIndianPAN(panVal)) {
          const panTokens = line.filter(t => {
            const clean = t.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            return clean.length > 0 && panVal.includes(clean);
          });
          const targetTokens = panTokens.length > 0 ? panTokens : line;
          fields.push({
            fieldType: 'PAN',
            detectedValue: panVal,
            bbox: computeBoundingBox(targetTokens),
            confidence: 0.99,
            tokens: targetTokens,
            category: 'GOV_ID',
            evidence: [{
              field: 'format_rule',
              matchedValue: panVal,
              matchedRule: `pan_entity_type_${panVal[3]}`,
              signalStrength: 'high',
            }],
          });
          continue;
        }
      }

      // Check multi-line PAN: "Permanent Account Number Card" on this line, PAN on next line
      if (FIELD_LABEL_PATTERNS.PAN.test(lineText)) {
        let foundPan = false;
        for (let offset = 1; offset <= 2 && lineIdx + offset < lines.length; offset++) {
          const nextLine = lines[lineIdx + offset]!;
          const nextText = nextLine.map(t => t.text).join(' ');
          const nextPanMatch = nextText.match(/\b([A-Z]{3}[PCHFATBLJG][A-Z][\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])\b/i) ||
                               nextText.match(/\b([A-Z]{5}[\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])\b/i) ||
                               nextText.match(/([A-Z]{3}[PCHFATBLJG][A-Z][\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])/i);
          if (nextPanMatch) {
            const panVal = normalizePanForOcr(nextPanMatch[1] || nextPanMatch[0]);
            if (validateIndianPAN(panVal)) {
              const panTokens = nextLine.filter(t => {
                const clean = t.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                return clean.length > 0 && panVal.includes(clean);
              });
              const targetTokens = panTokens.length > 0 ? panTokens : nextLine;
              fields.push({
                fieldType: 'PAN',
                detectedValue: panVal,
                bbox: computeBoundingBox(targetTokens),
                confidence: 0.99,
                tokens: targetTokens,
                category: 'GOV_ID',
                evidence: [{
                  field: 'format_rule',
                  matchedValue: panVal,
                  matchedRule: 'pan_multiline_pattern',
                  signalStrength: 'high',
                }],
              });
              foundPan = true;
              break;
            }
          }
        }
        if (foundPan) continue;
      }
      
      // Try Aadhaar extraction
      const aadhaarDirectMatch = lineText.match(/\b[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}\b/);
      if (aadhaarDirectMatch) {
        const aadhaarTokens = line.filter(t => aadhaarDirectMatch[0]?.includes(t.text.trim()));
        const targetTokens = aadhaarTokens.length > 0 ? aadhaarTokens : line;
        fields.push({
          fieldType: 'AADHAAR',
          detectedValue: aadhaarDirectMatch[0],
          bbox: computeBoundingBox(targetTokens),
          confidence: 0.95,
          tokens: targetTokens,
          category: 'GOV_ID',
          evidence: [{
            field: 'format_rule',
            matchedValue: aadhaarDirectMatch[0],
            matchedRule: 'aadhaar_pattern',
            signalStrength: 'high',
          }],
        });
        continue;
      }
      
      // Try name extraction
      if (FIELD_LABEL_PATTERNS.NAME.test(lineText) && !FIELD_LABEL_PATTERNS.FATHER_NAME.test(lineText)) {
        let foundLabel = false;
        const nameTokens: OcrToken[] = [];
        
        for (const token of line) {
          if (FIELD_LABEL_PATTERNS.NAME.test(token.text)) {
            foundLabel = true;
            continue;
          }
          if (foundLabel && token.text.trim().length > 0 && !/^[:\-\/]$/.test(token.text)) {
            nameTokens.push(token);
          }
        }
        
        if (nameTokens.length === 0) {
          for (let offset = 1; offset <= 2 && lineIdx + offset < lines.length; offset++) {
            const nextLine = lines[lineIdx + offset]!;
            const nextText = nextLine.map(t => t.text).join(' ').trim();
            if (
              nextText.length > 2 &&
              !FIELD_LABEL_PATTERNS.FATHER_NAME.test(nextText) &&
              !FIELD_LABEL_PATTERNS.DOB.test(nextText) &&
              !FIELD_LABEL_PATTERNS.PAN.test(nextText) &&
              !/\b[A-Z]{5}[\s\-]?\d{4}[\s\-]?[A-Z]\b/i.test(nextText)
            ) {
              nameTokens.push(...nextLine);
              break;
            }
          }
        }
        
        if (nameTokens.length > 0) {
          fields.push({
            fieldType: 'NAME',
            detectedValue: nameTokens.map(t => t.text).join(' '),
            bbox: computeBoundingBox(nameTokens),
            confidence: 0.88,
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
        let foundLabel = false;
        const fatherNameTokens: OcrToken[] = [];
        
        for (const token of line) {
          if (FIELD_LABEL_PATTERNS.FATHER_NAME.test(token.text) || token.text.toLowerCase() === 'name:') {
            foundLabel = true;
            continue;
          }
          if (foundLabel && token.text.trim().length > 0 && !/^[:\-\/]$/.test(token.text)) {
            fatherNameTokens.push(token);
          }
        }
        
        if (fatherNameTokens.length === 0) {
          for (let offset = 1; offset <= 2 && lineIdx + offset < lines.length; offset++) {
            const nextLine = lines[lineIdx + offset]!;
            const nextText = nextLine.map(t => t.text).join(' ').trim();
            if (
              nextText.length > 2 &&
              !FIELD_LABEL_PATTERNS.DOB.test(nextText) &&
              !FIELD_LABEL_PATTERNS.PAN.test(nextText) &&
              !/\b[A-Z]{5}[\s\-]?\d{4}[\s\-]?[A-Z]\b/i.test(nextText)
            ) {
              fatherNameTokens.push(...nextLine);
              break;
            }
          }
        }
        
        if (fatherNameTokens.length > 0) {
          fields.push({
            fieldType: 'FATHER_NAME',
            detectedValue: fatherNameTokens.map(t => t.text).join(' '),
            bbox: computeBoundingBox(fatherNameTokens),
            confidence: 0.88,
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
      const dobMatch = lineText.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/);
      if (dobMatch && (FIELD_LABEL_PATTERNS.DOB.test(lineText) || documentType === 'ID_CARD')) {
        const dobTokens = line.filter(t => dobMatch[0]?.includes(t.text.trim()));
        const targetTokens = dobTokens.length > 0 ? dobTokens : line;
        fields.push({
          fieldType: 'DOB',
          detectedValue: dobMatch[0]!,
          bbox: computeBoundingBox(targetTokens),
          confidence: 0.90,
          tokens: targetTokens,
          category: 'DOB',
          evidence: [{
            field: 'format_rule',
            matchedValue: dobMatch[0]!,
            matchedRule: 'date_format_pattern',
            signalStrength: 'high',
          }],
        });
        continue;
      } else if (FIELD_LABEL_PATTERNS.DOB.test(lineText)) {
        for (let offset = 1; offset <= 2 && lineIdx + offset < lines.length; offset++) {
          const nextLine = lines[lineIdx + offset]!;
          const nextText = nextLine.map(t => t.text).join(' ');
          const nextDobMatch = nextText.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/);
          if (nextDobMatch) {
            const dobTokens = nextLine.filter(t => nextDobMatch[0]?.includes(t.text.trim()));
            const targetTokens = dobTokens.length > 0 ? dobTokens : nextLine;
            fields.push({
              fieldType: 'DOB',
              detectedValue: nextDobMatch[0]!,
              bbox: computeBoundingBox(targetTokens),
              confidence: 0.90,
              tokens: targetTokens,
              category: 'DOB',
              evidence: [{
                field: 'format_rule',
                matchedValue: nextDobMatch[0]!,
                matchedRule: 'date_multiline_pattern',
                signalStrength: 'high',
              }],
            });
            break;
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
  
  // Guarantee fallback: If no PAN was detected yet, scan all lines for any PAN sequence
  if (!fields.some(f => f.fieldType === 'PAN')) {
    for (const l of lines) {
      const text = l.map(t => t.text).join(' ');
      const m = text.match(/\b([A-Z]{3}[PCHFATBLJG][A-Z][\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])\b/i) ||
                text.match(/\b([A-Z]{5}[\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])\b/i) ||
                text.match(/([A-Z]{3}[PCHFATBLJG][A-Z][\s\-]?[0-9A-Za-z]{4}[\s\-]?[A-Z])/i);
      if (m) {
        const panVal = normalizePanForOcr(m[1] || m[0]);
        if (validateIndianPAN(panVal)) {
          const panTokens = l.filter(t => {
            const clean = t.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            return clean.length > 0 && panVal.includes(clean);
          });
          const targetTokens = panTokens.length > 0 ? panTokens : l;
          fields.push({
            fieldType: 'PAN',
            detectedValue: panVal,
            bbox: computeBoundingBox(targetTokens),
            confidence: 0.98,
            tokens: targetTokens,
            category: 'GOV_ID',
            evidence: [{
              field: 'format_rule',
              matchedValue: panVal,
              matchedRule: 'pan_fallback_scan',
              signalStrength: 'high',
            }],
          });
          break;
        }
      }
    }
  }

  // ID Card Name & Father Name fallback: On Indian ID cards (especially PAN),
  // cardholder name and father's name appear as uppercase lines.
  if (documentType === 'ID_CARD' || fields.some(f => f.fieldType === 'PAN')) {
    const hasName = fields.some(f => f.fieldType === 'NAME');
    const hasFatherName = fields.some(f => f.fieldType === 'FATHER_NAME');
    if (!hasName || !hasFatherName) {
      for (const l of lines) {
        const text = l.map(t => t.text).join(' ').trim().replace(/^[|:;\-_.]+\s*/, '');
        const words = text.split(/\s+/).filter(w => /^[A-Z][A-Za-z]{1,15}$/.test(w));
        const fullClean = words.join(' ');
        const isHeaderWord = /\b(?:INCOME|TAX|DEPARTMENT|GOVT|GOVERNMENT|OF|INDIA|ACCOUNT|NUMBER|CARD|PERMANENT|SIGNATURE|DATE|BIRTH|FATHER|NAME)\b/i.test(fullClean);
        if (!isHeaderWord && words.length >= 2 && words.length <= 4 && fullClean.length >= 6) {
          if (!fields.some(f => f.fieldType === 'NAME')) {
            const targetTokens = l.filter(t => words.some(w => t.text.includes(w)));
            fields.push({
              fieldType: 'NAME',
              detectedValue: fullClean,
              bbox: computeBoundingBox(targetTokens.length > 0 ? targetTokens : l),
              confidence: 0.92,
              tokens: targetTokens.length > 0 ? targetTokens : l,
              category: 'PERSON',
              evidence: [{
                field: 'format_rule',
                matchedValue: fullClean,
                matchedRule: 'id_card_name_structure',
                signalStrength: 'high',
              }],
            });
          } else if (!fields.some(f => f.fieldType === 'FATHER_NAME') && !fields.some(f => f.detectedValue === fullClean)) {
            const targetTokens = l.filter(t => words.some(w => t.text.includes(w)));
            fields.push({
              fieldType: 'FATHER_NAME',
              detectedValue: fullClean,
              bbox: computeBoundingBox(targetTokens.length > 0 ? targetTokens : l),
              confidence: 0.90,
              tokens: targetTokens.length > 0 ? targetTokens : l,
              category: 'PERSON',
              evidence: [{
                field: 'format_rule',
                matchedValue: fullClean,
                matchedRule: 'id_card_father_name_structure',
                signalStrength: 'high',
              }],
            });
          }
        }
      }
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
      tag: undefined,
    },
    reason: `Detected ${field.fieldType} field in document via OCR: "${field.detectedValue}"`,
    evidence: field.evidence,
    bbox: field.bbox,
    valueReference: `<REDACTED_${field.fieldType}>`,
    isMandatory: true,
  }));
}
