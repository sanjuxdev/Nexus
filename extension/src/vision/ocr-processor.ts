import Tesseract from 'tesseract.js';
import type { OcrToken, BBox } from '@contracts/index.js';

/**
 * OCR Processor for extracting text and bounding boxes from images.
 * 
 * Integrates Tesseract.js to provide:
 * - Word-level text extraction with confidence scores
 * - Precise bounding box coordinates for each detected word
 * - Support for multiple languages (eng, hin, kan)
 * - Fast mode for real-time privacy detection
 * 
 * This module is detection-focused only. It does NOT perform redaction.
 */

export interface OcrConfig {
  languages: string[]; // e.g., ['eng', 'hin', 'kan']
  mode: 'fast' | 'accurate';
  confidenceThreshold: number; // 0-100, filter low-confidence results
}

export interface OcrExtractionResult {
  tokens: OcrToken[];
  fullText: string;
  processingTimeMs: number;
  languageUsed: string;
}

const DEFAULT_CONFIG: OcrConfig = {
  languages: ['eng'], // Start with English, expand incrementally
  mode: 'fast',
  confidenceThreshold: 25, // Lowered from 60 to 25 to reliably detect ID card numbers and names
};

let ocrWorker: Tesseract.Worker | null = null;

/**
 * Initialize OCR worker (reusable across multiple images)
 * Uses Tesseract.js default CDN for language data and WASM core
 */
async function ensureOcrWorker(config: OcrConfig = DEFAULT_CONFIG): Promise<Tesseract.Worker> {
  const languages = (config && config.languages && config.languages.length > 0) ? config.languages : DEFAULT_CONFIG.languages;
  const primaryLang = languages[0] || 'eng';

  if (!ocrWorker) {
    console.log(`[OCR] Initializing Tesseract.js worker (language: ${primaryLang})...`);
    
    try {
      ocrWorker = await Tesseract.createWorker(primaryLang, 1, {
        logger: (m: any) => {
          // Log initialization progress
          if (m.status && ['recognizing text', 'loading tesseract core', 'initializing tesseract', 'loading language traineddata'].includes(m.status)) {
            console.log(`[OCR] ${m.status}${m.progress ? ` (${(m.progress * 100).toFixed(0)}%)` : ''}`);
          }
        },
        errorHandler: (err: any) => {
          console.error('[OCR] Worker error:', err);
        },
      });
      
      console.log('[OCR] Worker created, configuring parameters...');
      
      // Configure for speed vs accuracy trade-off
      if (config.mode === 'fast') {
        // PSM 3 = Fully automatic page segmentation (no OSD)
        // OEM 1 = LSTM neural nets mode (faster than legacy + LSTM combo)
        await ocrWorker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.AUTO,
          tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
        });
      } else {
        await ocrWorker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.AUTO,
          tessedit_ocr_engine_mode: Tesseract.OEM.DEFAULT,
        });
      }
      
      console.log('[OCR] ✓ Worker initialized and ready for text extraction');
    } catch (initErr) {
      console.error('[OCR] ✗ Failed to initialize worker:', initErr);
      ocrWorker = null;
      throw initErr;
    }
  }
  return ocrWorker;
}

/**
 * Extract text and bounding boxes from an image.
 * 
 * @param imageData - Base64 data URL or ImageBitmap
 * @param viewport - Original viewport dimensions for coordinate normalization
 * @param config - OCR configuration
 * @returns Extracted tokens with precise bounding boxes
 */
export async function extractTextFromImage(
  imageData: string | ImageBitmap,
  viewport: { w: number; h: number },
  config: OcrConfig = DEFAULT_CONFIG
): Promise<OcrExtractionResult> {
  const t0 = performance.now();
  
  try {
    const worker = await ensureOcrWorker(config);
    
    // In Tesseract.js v5/v6, blocks: true must be passed in options to populate words/lines
    const result = await worker.recognize(imageData as any, {}, { blocks: true } as any);
    const processingTimeMs = performance.now() - t0;
    
    const languages = (config && config.languages && config.languages.length > 0) ? config.languages : DEFAULT_CONFIG.languages;
    const primaryLang = languages[0] || 'eng';

    if (!result || !result.data) {
      return {
        tokens: [],
        fullText: '',
        processingTimeMs,
        languageUsed: primaryLang,
      };
    }
    
    const fullText = result.data.text || '';
    
    // In Tesseract.js v5/v6, words are organized in blocks -> paragraphs -> lines -> words
    const rawWords: Array<{ word: any; lineId: number }> = [];
    let lineIndex = 0;
    if (result.data.blocks && Array.isArray(result.data.blocks)) {
      for (const block of result.data.blocks) {
        for (const para of (block.paragraphs || [])) {
          for (const line of (para.lines || [])) {
            const lineId = typeof (line as any).lineNumber === 'number' ? (line as any).lineNumber : lineIndex++;
            for (const word of (line.words || [])) {
              rawWords.push({
                word,
                lineId,
              });
            }
          }
        }
      }
    } else if ((result.data as any).words && Array.isArray((result.data as any).words)) {
      for (const word of (result.data as any).words) {
        rawWords.push({
          word,
          lineId: (word as any).line_id ?? (word as any).line?.lineNumber ?? 0,
        });
      }
    }
    
    // Convert Tesseract word results to OcrToken format
    const tokens: OcrToken[] = [];
    const minConfidence = config.confidenceThreshold ?? 25;
    
    for (let i = 0; i < rawWords.length; i++) {
      const item = rawWords[i];
      if (!item) continue;
      const { word, lineId } = item;
      if (!word || !word.text || !word.bbox) continue;
      
      const text = String(word.text).trim();
      if (!text) continue;
      
      const confidence = typeof word.confidence === 'number' ? word.confidence : 50;
      
      // Filter out low-confidence noise
      if (confidence < minConfidence) {
        continue;
      }
      
      // Tesseract bbox format: { x0, y0, x1, y1 }
      // Convert to our BBox format: [x, y, width, height]
      const bbox: BBox = [
        Math.round(word.bbox.x0),
        Math.round(word.bbox.y0),
        Math.round(word.bbox.x1 - word.bbox.x0),
        Math.round(word.bbox.y1 - word.bbox.y0),
      ];
      
      tokens.push({
        text,
        bbox,
        confidence: confidence / 100, // Normalize to 0-1 range
        line_id: lineId,
      });
    }
    
    console.log(`[OCR] Extracted ${tokens.length} words in ${processingTimeMs.toFixed(0)}ms (confidence >= ${minConfidence})`);
    
    return {
      tokens,
      fullText,
      processingTimeMs,
      languageUsed: primaryLang,
    };
  } catch (err) {
    console.error('[OCR] Text extraction failed:', err);
    const languages = (config && config.languages && config.languages.length > 0) ? config.languages : DEFAULT_CONFIG.languages;
    return {
      tokens: [],
      fullText: '',
      processingTimeMs: performance.now() - t0,
      languageUsed: languages[0] || 'eng',
    };
  }
}

/**
 * Cleanup OCR worker resources
 */
export async function terminateOcrWorker(): Promise<void> {
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
}

/**
 * Group OCR tokens into logical text lines based on vertical proximity.
 * Useful for detecting multi-word field values (e.g., "Date of Birth: 15/08/1990")
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
      // Same line
      currentLine.push(token);
    } else {
      // New line
      lines.push(currentLine);
      currentLine = [token];
    }
  }
  
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Ensure tokens within each line are ordered strictly left-to-right by X coordinate
  for (const line of lines) {
    line.sort((a, b) => a.bbox[0] - b.bbox[0]);
  }
  
  return lines;
}

/**
 * Reconstruct full text with original spacing from OCR tokens.
 * Preserves line breaks and word spacing for accurate regex matching.
 */
export function reconstructTextWithSpacing(tokens: OcrToken[]): string {
  const lines = groupTokensIntoLines(tokens);
  return lines.map(line => line.map(t => t.text).join(' ')).join('\n');
}
