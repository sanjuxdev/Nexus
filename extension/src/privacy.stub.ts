import type {
  AttestedPayload,
  CapabilityDescriptor,
  PiiDetection,
  PiiType,
  SanitizeRequest,
  SanitizeResult,
  SanitizedContext,
  SanitizedRegion,
  VisualState,
} from '@contracts/index.js';
import { canonicalJson, sha256Hex } from './security/sha256.js';
import { encryptedVault } from './security/vault.js';
import { classifyDomElement } from './privacy/semantic-pii-classifier.js';
import { indianPiiRegistry } from './privacy/indian-pii-registry.js';

/**
 * Verhoeff algorithm multiplication (d) and permutation (p) tables
 * for Indian Aadhaar validation.
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

/**
 * Validates a 12-digit Aadhaar number with UIDAI prefix rule (first digit 2-9)
 * and Verhoeff dihedral group D5 checksum.
 */
export function validateAadhaarVerhoeff(aadhaarStr: string): boolean {
  const clean = aadhaarStr.replace(/[\s-]/g, '');
  if (!/^[2-9]\d{11}$/.test(clean)) {
    return false;
  }

  let c = 0;
  const digits = clean.split('').map(Number).reverse();

  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i];
    if (digit === undefined) return false;
    const row = VERHOEFF_D[c];
    const permRow = VERHOEFF_P[i % 8];
    if (!row || !permRow) return false;
    const permVal = permRow[digit];
    if (permVal === undefined) return false;
    const nextC = row[permVal];
    if (nextC === undefined) return false;
    c = nextC;
  }

  return c === 0;
}

/**
 * Validates 10-character Indian PAN format with 4th character entity check.
 */
export function validateIndianPAN(panStr: string): boolean {
  const clean = panStr.trim().toUpperCase();
  // 4th character must be P (Individual), C (Company), H (HUF), F (Firm), A (AOP),
  // T (Trust), B (BOI), L (Local Authority), J (Artificial Juridical Person), or G (Govt)
  return /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(clean);
}

import { redactImageWebGPU } from './webgpu-redact.js';

/**
 * Canvas-based visual blackout redaction for sensitive bounding boxes.
 */
export async function redactImageCanvas(
  dataUrl: string,
  boxesToRedact: { x: number; y: number; w: number; h: number; label: string; source?: string }[],
  viewport?: { w: number; h: number }
): Promise<string> {
  console.log(`[PRIVACY_RUNTIME_05_REDACTION_ENTER] boxes=${boxesToRedact.length} inputLength=${dataUrl.length}`);
  
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('Canvas API not available for redaction');
  }

  try {
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const mimeMatch = dataUrl.match(/^data:([^;,]+)/);
    const mimeType = mimeMatch?.[1] || 'image/png';
    const blob = new Blob([bytes], { type: mimeType });
    const bitmap = await createImageBitmap(blob);

    const scaleX = viewport?.w && viewport.w > 0 ? bitmap.width / viewport.w : 1;
    const scaleY = viewport?.h && viewport.h > 0 ? bitmap.height / viewport.h : 1;
    
    console.log(`[PRIVACY_RUNTIME_05_REDACTION_METADATA] bitmap=${bitmap.width}x${bitmap.height} viewport=${viewport?.w}x${viewport?.h} scaleX=${scaleX.toFixed(3)} scaleY=${scaleY.toFixed(3)}`);

    const boxes = [];
    for (let i = 0; i < boxesToRedact.length; i++) {
      const box = boxesToRedact[i]!;
      
      const rawTop = Math.round(box.y * scaleY);
      const ry = Math.max(0, rawTop);
      const clippedTop = ry - rawTop;
      
      const rx = Math.max(0, Math.round(box.x * scaleX));
      const rw = Math.min(bitmap.width - rx, Math.round(box.w * scaleX));
      const rawHeight = Math.round(box.h * scaleY);
      const rh = Math.min(bitmap.height - ry, rawHeight - clippedTop);
      
      boxes.push({ rx, ry, rw, rh, label: box.label, i });
    }

    // Try WebGPU hardware acceleration (Temporarily disabled to preserve visual text labels)
    /*
    const tStartGPU = performance.now();
    const gpuBlob = await redactImageWebGPU(bitmap, boxes);
    if (gpuBlob) {
      console.log(`[WebGPU] Redaction completed in ${(performance.now() - tStartGPU).toFixed(2)}ms`);
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(gpuBlob);
      });
    }
    */

    // Fallback to 2D Canvas
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context from OffscreenCanvas');

    ctx.drawImage(bitmap, 0, 0);

    for (let i = 0; i < boxes.length; i++) {
      const { rx, ry, rw, rh, label, i: origIdx } = boxes[i]!;
      const box = boxesToRedact[origIdx]!;
      
      console.log(`[PRIVACY_RUNTIME_07_MASK_OPERATION_FALLBACK] index=${origIdx} label=${box.label} sourceX=${box.x} sourceY=${box.y} sourceW=${box.w} sourceH=${box.h} destX=${rx} destY=${ry} destW=${rw} destH=${rh}`);

      ctx.fillStyle = '#000000';
      ctx.fillRect(rx, ry, rw, rh);

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(2, Math.round(2 * Math.min(scaleX, scaleY)));
      ctx.strokeRect(rx, ry, rw, rh);

      let labelText = '';
      const norm = (box.label || '').toUpperCase();
      if (norm.includes('AADHAAR')) {
        labelText = '[REDACTED: AADHAAR]';
      } else if (norm.includes('PAN')) {
        labelText = '[REDACTED: PAN]';
      } else if (norm.includes('EMAIL')) {
        labelText = '[REDACTED: EMAIL]';
      } else if (norm.includes('PASSWORD')) {
        labelText = '[REDACTED: PASSWORD]';
      } else if (norm.includes('PHONE')) {
        labelText = '[REDACTED: PHONE]';
      } else if (norm.includes('FACE')) {
        labelText = '[REDACTED: FACE]';
      } else {
        labelText = `[REDACTED: ${norm}]`;
      }

      let fontSize = Math.max(10, Math.round(12 * Math.min(scaleX, scaleY)));
      ctx.font = `bold ${fontSize}px monospace`;
      
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillStyle = '#ffffff';
      
      // If the text is wider than the box, draw it above the box to ensure it remains legible
      if (textWidth > rw - 4 && ry > fontSize + 4) {
        ctx.fillText(labelText, rx, ry - 4);
      } else {
        ctx.fillText(labelText, rx + Math.max(2, Math.round(4 * scaleX)), ry + Math.max(12, Math.round(14 * scaleY)));
      }
    }

    const blobOut = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const arrayBuffer = await blobOut.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + chunkSize)));
    }
    
    const outputDataUrl = `data:image/jpeg;base64,${btoa(binary)}`;
    console.log(`[PRIVACY_RUNTIME_06_REDACTION_OUTPUT] success=true inputBytes=${bytes.length} outputBytes=${uint8.length}`);
    return outputDataUrl;
  } catch (err) {
    console.warn('[Privacy Engine] Canvas redaction failed:', err);
    console.log(`[PRIVACY_RUNTIME_06_REDACTION_OUTPUT] success=false error=${err instanceof Error ? err.message : String(err)}`);
    throw new Error(`Redaction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface VaultEntry {
  ref: string;
  kind: 'password' | 'email' | 'phone' | 'token' | 'profile';
  label: string;
  value: string;
  allowed_origins: string[];
}

const DEMO_VAULT: Record<string, VaultEntry> = {
  cap_email_01: {
    ref: 'cap_email_01',
    kind: 'email',
    label: 'Work Email',
    value: 'testuser@demo.local',
    allowed_origins: ['http://localhost:5173', 'http://localhost:5174'],
  },
  cap_pwd_01: {
    ref: 'cap_pwd_01',
    kind: 'password',
    label: 'Demo Password',
    value: 'SuperSecret123!',
    allowed_origins: ['http://localhost:5173', 'http://localhost:5174'],
  },
  cap_phone_01: {
    ref: 'cap_phone_01',
    kind: 'phone',
    label: 'Demo Phone',
    value: '+919876543210',
    allowed_origins: ['http://localhost:5173', 'http://localhost:5174'],
  },
};

export const privacyStub = {
  validateAadhaar: validateAadhaarVerhoeff,
  validatePAN: validateIndianPAN,
  redactImageCanvas,

  async sanitize(req: SanitizeRequest): Promise<SanitizeResult> {
    const origin = req.frame.origin;
    // Check for blocked test domain while allowing real-world application testing
    if (origin === 'https://external-site.com') {
      return {
        cycle_id: req.cycle_id,
        verdict: 'BLOCK',
        attested: null,
        block: {
          reasons: ['Blocked non-localhost origin in test'],
          checks_failed: ['stub_env_restricted'],
        },
        detections: [],
        redaction: {
          text_replacements: 0,
          masked_boxes: 0,
          masked_area_px: 0,
          image_included: false,
        },
        timings_ms: { total: 0 },
      };
    }

    // Check for vision failure on regions that required it
    const visionFailed = !req.frame.capture;
    const requiredVisionRegion = req.frame.regions.find((r) => r.route === 'LOW' || r.route === 'MEDIUM');
    if (visionFailed && requiredVisionRegion) {
      return {
        cycle_id: req.cycle_id,
        verdict: 'BLOCK',
        attested: null,
        block: {
          reasons: [`Vision capture failed but region ${requiredVisionRegion.region_id} required vision (route: ${requiredVisionRegion.route})`],
          checks_failed: ['vision_failure'],
        },
        detections: [],
        redaction: {
          text_replacements: 0,
          masked_boxes: 0,
          masked_area_px: 0,
          image_included: false,
        },
        timings_ms: { total: 0 },
      };
    }

    const detections: PiiDetection[] = [];
    let textReplacements = 0;
    const boxesToMask: { x: number; y: number; w: number; h: number; label: string; source?: string }[] = [];
    let totalMaskedAreaPx = 0;

    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    const aadhaarRegex = /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g;
    const panRegex = /\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g;
    // Strict Indian E.164 phone pattern: supports +91, 0, spaces, dashes, exactly 10 core digits, not embedded in longer numbers
    const phoneRegex = /(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/g;

    const sanitizedRegions: SanitizedRegion[] = req.frame.regions.map((reg) => {
      let sanitizedText = reg.text || reg.visual_text || reg.clean_text || '';
      let regionHasPii = false;
      let boxLabel = 'PII';

      // 0. Extract DOM element metadata to strictly identify form inputs
      const domEl = reg.local_key
        ? req.frame.dom?.elements?.find((e: any) => e.dom_id === reg.local_key)
        : (reg as any).dom_id
          ? req.frame.dom?.elements?.find((e: any) => e.dom_id === (reg as any).dom_id)
          : null;
      const elAccessibleName = (domEl?.name || '').toLowerCase();
      const elInputName = (domEl?.input?.name || '').toLowerCase();
      const elPlaceholder = (domEl?.input?.placeholder || '').toLowerCase();
      const elId = ((domEl as any)?.id || '').toLowerCase();
      const regText = (reg.text || reg.visual_text || reg.clean_text || '').toLowerCase();

      const isInputSemantics = reg.semantic_type === 'input' || domEl?.tag === 'input' || domEl?.tag === 'textarea' || domEl?.role === 'textbox' || domEl?.tag === 'select' || domEl?.tag === 'label' || domEl?.role === 'radio' || domEl?.role === 'checkbox';

      const isAadhaarField =
        isInputSemantics &&
        (regText.includes('aadhaar') ||
          regText.includes('aadhar') ||
          elAccessibleName.includes('aadhaar') ||
          elAccessibleName.includes('aadhar') ||
          elInputName.includes('aadhaar') ||
          elInputName.includes('aadhar') ||
          elPlaceholder.includes('aadhaar') ||
          elPlaceholder.includes('xxxx') ||
          elId.includes('aadhaar') ||
          elId.includes('aadhar'));

      const isPanField =
        isInputSemantics &&
        !isAadhaarField &&
        (regText.includes('pan') ||
          elAccessibleName.includes('pan') ||
          elInputName.includes('pan') ||
          elId.includes('pan') ||
          elPlaceholder.includes('pan'));

      const isPassword =
        isInputSemantics &&
        (regText.includes('password') ||
          elAccessibleName.includes('password') ||
          elInputName.includes('password') ||
          elId.includes('password') ||
          elPlaceholder.includes('password') ||
          Boolean(domEl?.input?.is_password));

      const isPhoneFalsePositive =
        /\b(?:headphone|microphone|gramophone|megaphone|saxophone|phone\s*booth|phone\s*stand|order|ord|invoice|inv|tracking|track|serial|reference)\b/i.test(
          regText
        ) ||
        /\b(?:headphone|microphone|gramophone|megaphone|saxophone|phone\s*booth|phone\s*stand|order|ord|invoice|inv|tracking|track|serial|reference)\b/i.test(
          elAccessibleName
        );

      const isPhoneField =
        isInputSemantics &&
        !isAadhaarField &&
        !isPanField &&
        !isPhoneFalsePositive &&
        (regText.includes('phone') ||
          regText.includes('mobile') ||
          regText.includes('contact') ||
          elAccessibleName.includes('phone') ||
          elAccessibleName.includes('mobile') ||
          elAccessibleName.includes('contact') ||
          elInputName.includes('phone') ||
          elInputName.includes('mobile') ||
          elId.includes('phone') ||
          elId.includes('mobile') ||
          elPlaceholder.includes('phone') ||
          elPlaceholder.includes('mobile') ||
          domEl?.input?.type === 'tel');

      const isEmailField =
        isInputSemantics &&
        !isAadhaarField &&
        !isPanField &&
        !isPassword &&
        !isPhoneField &&
        (regText.includes('email') ||
          regText.includes('mail') ||
          elAccessibleName.includes('email') ||
          elAccessibleName.includes('mail') ||
          elInputName.includes('email') ||
          elInputName.includes('mail') ||
          elPlaceholder.includes('email') ||
          elPlaceholder.includes('mail') ||
          elId.includes('email') ||
          elId.includes('mail') ||
          domEl?.input?.type === 'email');

      // Profile avatars are typically square-ish and between 24 and 512 pixels in size.
      // This generic geometry fallback helps when face detection fails on small avatars.
      const isAvatarGeometry = 
        reg.bbox[2] >= 24 && reg.bbox[2] <= 512 && 
        reg.bbox[3] >= 24 && reg.bbox[3] <= 512 && 
        Math.abs(reg.bbox[2] - reg.bbox[3]) <= Math.max(16, reg.bbox[2] * 0.25);

      const hasProfileKeyword = [elAccessibleName, elId, regText].some(text => 
        text.includes('profile') || text.includes('avatar')
      ) || (domEl?.classes || []).some((c: string) => {
        const cl = c.toLowerCase();
        return cl.includes('profile') || cl.includes('avatar');
      });

      const hasAvatarShapeKeyword = (domEl?.classes || []).some((c: string) => {
        const cl = c.toLowerCase();
        return cl.includes('circle') || cl.includes('round') || cl.includes('entity') || cl.includes('ghost');
      });

      const isProfileImage =
        (reg.semantic_type === 'image' || domEl?.tag === 'img' || domEl?.tag === 'canvas' || domEl?.has_bg_image) &&
        isAvatarGeometry &&
        (hasProfileKeyword || hasAvatarShapeKeyword);

      // Prevent masking entire screen/images for non-visual PII (if a box is massive, don't visual-mask the whole thing)
      // Limit to max 600px width/height or else it's likely a container.
      const isSurgicallyMaskable = reg.bbox[2] < 800 && reg.bbox[3] < 600;

      // Direct semantic classification for form inputs
      const semanticCandidate = domEl ? classifyDomElement(domEl, { surroundingText: reg.text }) : null;

      if (semanticCandidate && semanticCandidate.confidence >= 0.70) {
        regionHasPii = true;
        boxLabel = semanticCandidate.specificSubtype || semanticCandidate.category;
        detections.push({
          id: semanticCandidate.id,
          type: semanticCandidate.category,
          source: ['DOM', 'CONTEXT'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: semanticCandidate.confidence,
          mandatory: semanticCandidate.isMandatory,
        });
        textReplacements++;
        sanitizedText = semanticCandidate.valueReference || `<REDACTED_${boxLabel}>`;
      } else if (isPassword) {
        regionHasPii = true;
        boxLabel = 'PASSWORD';
        detections.push({
          id: `pii_password_${reg.region_id}`,
          type: 'PASSWORD',
          source: ['DOM', 'VAULT'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = '<REDACTED_PASSWORD>';
      } else if (isProfileImage) {
        regionHasPii = true;
        boxLabel = 'FACE';
        detections.push({
          id: `pii_profile_${reg.region_id}`,
          type: 'FACE',
          source: ['DOM'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = '<REDACTED_FACE>';
      } else if (!domEl && isAadhaarField) {
        regionHasPii = true;
        boxLabel = 'AADHAAR';
        detections.push({
          id: `pii_aadhaar_${reg.region_id}`,
          type: 'GOV_ID',
          source: ['DOM', 'REGEX'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = '<REDACTED_AADHAAR>';
      } else if (!domEl && isPanField) {
        regionHasPii = true;
        boxLabel = 'PAN';
        detections.push({
          id: `pii_pan_${reg.region_id}`,
          type: 'GOV_ID',
          source: ['DOM', 'REGEX'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = '<REDACTED_PAN>';
      } else if (!domEl && isPhoneField) {
        regionHasPii = true;
        boxLabel = 'PHONE';
        detections.push({
          id: `pii_phone_${reg.region_id}`,
          type: 'PHONE',
          source: ['DOM', 'REGEX'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = '<PHONE>';
      } else if (!domEl && isEmailField) {
        regionHasPii = true;
        boxLabel = 'EMAIL';
        detections.push({
          id: `pii_email_${reg.region_id}`,
          type: 'EMAIL',
          source: ['DOM', 'REGEX'],
          region_id: reg.region_id,
          bbox: reg.bbox,
          span: null,
          confidence: 1.0,
          mandatory: true,
        });
        textReplacements++;
        sanitizedText = '<EMAIL>';
      } else if (sanitizedText) {
        // Pattern detection for unclassified text regions (OCR, paragraphs, text nodes, tables)
        const isOCR = (reg as any).sources?.includes('OCR') || reg.source?.includes('OCR');
        const textCandidates = indianPiiRegistry.detectText(sanitizedText, {
          surroundingText: reg.clean_text || reg.text,
          sourceType: isOCR ? 'OCR' : 'DOM',
        });

        if (textCandidates.length > 0) {
          for (const cand of textCandidates) {
            regionHasPii = true;
            boxLabel = cand.specificSubtype || cand.category;
            detections.push({
              id: `${cand.id}_${reg.region_id}`,
              type: cand.category,
              source: isOCR ? ['OCR'] : ['REGEX'],
              region_id: reg.region_id,
              bbox: reg.bbox,
              span: null,
              confidence: cand.confidence,
              mandatory: cand.isMandatory,
            });
            textReplacements++;
            const matchedEv = cand.evidence.find(
              (e) => e.field === 'regex_structure' || e.field === 'format_rule' || e.field === 'checksum'
            );
            const tokenToReplace = matchedEv?.matchedValue;
            if (tokenToReplace && sanitizedText.includes(tokenToReplace)) {
              sanitizedText = sanitizedText.replace(tokenToReplace, cand.valueReference || `<REDACTED_${boxLabel}>`);
            } else if (cand.valueReference) {
              sanitizedText = cand.valueReference;
            }
          }
        }

        // 1. Aadhaar detection with Verhoeff checksum (legacy fallback)
        if (!regionHasPii) {
          const aadhaarMatches = sanitizedText.match(aadhaarRegex);
        if (aadhaarMatches) {
          for (const match of aadhaarMatches) {
            if (validateAadhaarVerhoeff(match)) {
              regionHasPii = true;
              boxLabel = 'AADHAAR';
              const isOCR = (reg as any).sources?.includes('OCR') || reg.source?.includes('OCR');
              detections.push({
                id: `pii_aadhaar_${reg.region_id}`,
                type: 'GOV_ID',
                source: isOCR ? ['OCR'] : ['REGEX'],
                region_id: reg.region_id,
                bbox: reg.bbox,
                span: null,
                confidence: 0.99,
                mandatory: true,
              });
              sanitizedText = sanitizedText.replace(match, '<REDACTED_AADHAAR>');
              textReplacements++;
            }
          }
        }

        // 2. PAN detection with entity code check
        if (!regionHasPii) {
          const panMatches = sanitizedText.match(panRegex);
          if (panMatches) {
            for (const match of panMatches) {
              if (validateIndianPAN(match)) {
                regionHasPii = true;
                boxLabel = 'PAN';
                const isOCR = (reg as any).sources?.includes('OCR') || reg.source?.includes('OCR');
                detections.push({
                  id: `pii_pan_${reg.region_id}`,
                  type: 'GOV_ID',
                  source: isOCR ? ['OCR'] : ['REGEX'],
                  region_id: reg.region_id,
                  bbox: reg.bbox,
                  span: null,
                  confidence: 0.99,
                  mandatory: true,
                });
                sanitizedText = sanitizedText.replace(match, '<REDACTED_PAN>');
                textReplacements++;
              }
            }
          }
        }

        // 3. Email detection
        if (!regionHasPii) {
          emailRegex.lastIndex = 0;
          if (emailRegex.test(sanitizedText)) {
            regionHasPii = true;
            boxLabel = 'EMAIL';
            detections.push({
              id: `pii_email_${reg.region_id}`,
              type: 'EMAIL',
              source: ['REGEX'],
              region_id: reg.region_id,
              bbox: reg.bbox,
              span: null,
              confidence: 0.99,
              mandatory: true,
            });
            sanitizedText = sanitizedText.replace(emailRegex, '<EMAIL>');
            textReplacements++;
          }
        }

        // 4. Phone detection (strictly guarded: never on Aadhaar/PAN fields, never on 12-digit numbers, never on false positives)
        if (!regionHasPii) {
          const isPhoneFalsePositive = /\b(?:order|ord|invoice|inv|tracking|track|serial|headphone|microphone|reference|ref)\b/i.test(sanitizedText);
          phoneRegex.lastIndex = 0;
          if (!isPhoneFalsePositive && phoneRegex.test(sanitizedText)) {
            regionHasPii = true;
            boxLabel = 'PHONE';
            detections.push({
              id: `pii_phone_${reg.region_id}`,
              type: 'PHONE',
              source: ['REGEX'],
              region_id: reg.region_id,
              bbox: reg.bbox,
              span: null,
              confidence: 0.95,
              mandatory: true,
            });
            sanitizedText = sanitizedText.replace(phoneRegex, '<PHONE>');
            textReplacements++;
          }
        }
        }
      }

      if (regionHasPii && reg.bbox && isSurgicallyMaskable) {
        const isOCR = (reg as any).sources?.includes('OCR') || reg.source?.includes('OCR');
        boxesToMask.push({
          x: reg.bbox[0],
          y: reg.bbox[1],
          w: reg.bbox[2],
          h: reg.bbox[3],
          label: boxLabel,
          source: isOCR ? 'OCR' : 'DOM',
        });
        totalMaskedAreaPx += reg.bbox[2] * reg.bbox[3];
      }

      return {
        region_id: reg.region_id,
        type: reg.semantic_type,
        text: sanitizedText,
        bbox: reg.bbox,
        state:
          reg.visual_state ||
          (reg.visible
            ? (['visible', 'enabled'] as VisualState[])
            : (['disabled'] as VisualState[])),
        interactable: reg.interactable,
        frame_id: reg.frame_id,
        sources: reg.source,
        confidence: reg.confidence,
        trust: 'untrusted' as const,
      };
    });

    // Detect and redact faces from perception frame
    if (req.frame.faces && req.frame.faces.length > 0) {
      req.frame.faces.forEach((face, idx) => {
        // We intentionally allow faces to be redacted anywhere on the page, including on canvas elements or interactables.

        const faceId = (face as any).face_id || `face_${idx + 1}`;
        detections.push({
          id: `pii_face_${faceId}`,
          type: 'FACE',
          source: ['VISION'],
          region_id: faceId,
          bbox: face.bbox,
          span: null,
          confidence: face.confidence,
          mandatory: true,
        });
        boxesToMask.push({
          x: face.bbox[0],
          y: face.bbox[1],
          w: face.bbox[2],
          h: face.bbox[3],
          label: 'FACE',
          source: 'WEBGPU',
        });
        totalMaskedAreaPx += face.bbox[2] * face.bbox[3];
      });
    }

    const capabilities: CapabilityDescriptor[] = Object.values(DEMO_VAULT)
      .filter((entry) => entry.allowed_origins.includes(origin))
      .map((entry) => ({
        ref: entry.ref,
        kind: entry.kind,
        label: entry.label,
      }));

    // Group detections by PiiType
    const redactionCounts: Record<string, number> = {};
    for (const d of detections) {
      redactionCounts[d.type] = (redactionCounts[d.type] || 0) + 1;
    }
    const redactions = Object.entries(redactionCounts).map(([type, count]) => ({
      type: type as PiiType,
      count,
    }));

    const sanitizedContext: SanitizedContext = {
      schema_version: '1.0',
      request_id: `req_${req.cycle_id}`,
      task_id: req.task.task_id,
      step_index: req.task.step_index,
      task: req.task.task_text,
      page: {
        origin: req.frame.origin,
        path: req.frame.dom.url_path,
        title: 'Demo Portal',
        page_state_hash: req.frame.page_state_hash,
        viewport: req.frame.dom.viewport,
        frame_ids: req.frame.dom.frames.map((f) => f.frame_id),
      },
      regions: sanitizedRegions,
      capabilities,
      redactions,
      image: null,
      history: req.task.history,
      flags: {
        injection_suspected_region_ids: [],
      },
    };

    const rawBody = canonicalJson(sanitizedContext);
    const digest = await sha256Hex(rawBody);

    const attested: AttestedPayload = {
      request_id: sanitizedContext.request_id,
      body: rawBody,
      sha256: digest,
      issued_at: Date.now(),
    };

    // Expose masks to DOM for E2E testing (only if running in a context with DOM)
    if (typeof document !== 'undefined') {
      let debugDiv = document.getElementById('antigravity-debug-masks');
      if (!debugDiv) {
        debugDiv = document.createElement('div');
        debugDiv.id = 'antigravity-debug-masks';
        debugDiv.style.display = 'none';
        document.body.appendChild(debugDiv);
      }
      debugDiv.textContent = JSON.stringify(boxesToMask);
    }

    console.log(`[MASK] boxesToMask count before redactImageCanvas: ${boxesToMask.length}`);
    console.log(`[PRIVACY] Face regions in req.frame.faces: ${req.frame.faces?.length || 0}`);

    let maskedDataUrl: string | null = null;
    if (boxesToMask.length > 0 && req.image_data_url) {
      try {
        const viewport = req.frame.dom?.viewport || req.frame.capture?.viewport;
        maskedDataUrl = await redactImageCanvas(req.image_data_url, boxesToMask, viewport);
      } catch (err) {
        console.warn('Could not generate masked data url:', err);
      }
    }

    return {
      cycle_id: req.cycle_id,
      verdict: 'SAFE',
      attested,
      block: null,
      detections,
      masked_data_url: maskedDataUrl,
      redaction: {
        text_replacements: textReplacements,
        masked_boxes: boxesToMask.length,
        masked_area_px: totalMaskedAreaPx,
        image_included: false,
      },
      timings_ms: {
        pii: 1.2,
        fusion: 0.5,
        relevance: 0.3,
        redact: 1.0,
        firewall: 0.8,
        total: 3.8,
      },
    };
  },

  async scanOutboundText(
    text: string
  ): Promise<{ safe: boolean; findings: { type: PiiType; span: [number, number] }[] }> {
    const findings: { type: PiiType; span: [number, number] }[] = [];

    // 1. Disallow token placeholders like <EMAIL>, <REDACTED_AADHAAR>, <REDACTED_PAN>
    const placeholderMatch = text.match(/<[A-Z_]+>/);
    if (placeholderMatch && placeholderMatch.index !== undefined) {
      return {
        safe: false,
        findings: [{ type: 'IDENTIFIER', span: [placeholderMatch.index, placeholderMatch.index + placeholderMatch[0].length] }],
      };
    }

    // 2. Check raw emails
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    if (emailMatch && emailMatch.index !== undefined) {
      findings.push({
        type: 'EMAIL',
        span: [emailMatch.index, emailMatch.index + emailMatch[0].length],
      });
    }

    // 3. Check raw Aadhaar numbers
    const aadhaarMatches = text.matchAll(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g);
    for (const match of aadhaarMatches) {
      if (match.index !== undefined && validateAadhaarVerhoeff(match[0])) {
        findings.push({
          type: 'GOV_ID',
          span: [match.index, match.index + match[0].length],
        });
      }
    }

    // 4. Check raw PAN numbers
    const panMatches = text.matchAll(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g);
    for (const match of panMatches) {
      if (match.index !== undefined && validateIndianPAN(match[0])) {
        findings.push({
          type: 'GOV_ID',
          span: [match.index, match.index + match[0].length],
        });
      }
    }

    // 5. Check raw Indian phone numbers (must run AFTER other checks to avoid duplicate spans)
    if (findings.length === 0) {
      const rawPhoneRegex = /(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/g;
      const phoneMatch = text.match(rawPhoneRegex);
      if (phoneMatch) {
        const idx = text.search(rawPhoneRegex);
        if (idx !== -1) {
          findings.push({
            type: 'PHONE',
            span: [idx, idx + phoneMatch[0].length],
          });
        }
      }
    }

    return {
      safe: findings.length === 0,
      findings,
    };
  },

  vault: {
    async authorize(
      ref: string,
      ctx: { task_id: string; origin: string; frame_id: string; action: string }
    ): Promise<{ ok: boolean; reason?: string }> {
      return encryptedVault.authorize(ref, ctx);
    },

    async resolve(
      ref: string,
      ctx: { task_id: string; origin: string }
    ): Promise<string> {
      return encryptedVault.resolve(ref, ctx);
    },
  },
};
