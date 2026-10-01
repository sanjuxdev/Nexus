import type { DomElementInfo, DomSnapshot, FrameInfo } from '@contracts/index.js';
import { isElementOccluded, isElementVisible } from './visibility.js';
import { detectRenderingKind } from './rendering-kind.js';
import { computeAriaRole, extractAriaStates } from '../accessibility/role.js';
import { computeElementAccessibleName } from '../accessibility/name.js';
import { getLocalFrameOffset } from '../../content/frame-offsets.js';
import { elementRegistry } from '../../content/registry.js';
import { computePageStateHash } from '../../browser/state/fingerprint.js';
import { extractEnhancedDomMetadata, EnhancedDomMetadata } from './aria-metadata.js';

const CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
  'dialog',
  '[role]',
  '[tabindex]',
  '[contenteditable]',
  'label',
  'h1, h2, h3, h4, h5, h6, p, blockquote, th, td, li, dt, dd, figcaption',
  'canvas',
  'svg',
  'img',
  'video',
  'iframe',
  '[class*="avatar"]',
  '[class*="profile"]',
  '[class*="user"]',
  '[class*="photo"]',
  '[class*="thumb"]'
].join(',');

interface CachedSemanticInfo {
  tag: string;
  role: string | null;
  name: string | null;
  aria: any;
  rendering: any;
  has_bg_image: boolean;
  handlers_hint: boolean;
  inputInfo: any;
  extractedText: string;
  classes: string[];
  piiMatches: { nodeIndex: number, start: number, end: number, text: string, type: string }[];
  attributes: Record<string, string>;
  enhanced: EnhancedDomMetadata;
}

interface CachedElement {
  isMeaningful: boolean;
  domId?: string;
  staticInfo?: CachedSemanticInfo;
}

const elementCache = new WeakMap<Element, CachedElement>();
let nextId = 1;
let nextPiiId = 1;

export function markDirty(el: Element | null) {
  if (!el) return;
  elementCache.delete(el);
}

export async function extractDomSnapshot(
  frameId = 'main',
  parentFrameId: string | null = null
): Promise<DomSnapshot> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      snapshot_id: `snap_${Date.now()}`,
      url_origin: 'http://localhost:5173',
      url_path: '/',
      frames: [
        {
          frame_id: frameId,
          parent_frame_id: parentFrameId,
          origin: 'http://localhost:5173',
          path: '/',
          offset: [0, 0],
          accessible: true,
        },
      ],
      elements: [],
      viewport: { w: 1280, h: 800 },
      dpr: 1,
      scroll: { x: 0, y: 0 },
      page_state_hash: '0000000000000000',
      ts: Date.now(),
    };
  }

  const urlOrigin = window.location.origin;
  const urlPath = window.location.pathname; // Stripped of query and hash
  const frameOffset = getLocalFrameOffset();

  const viewport = {
    w: document.documentElement?.clientWidth || window.innerWidth,
    h: document.documentElement?.clientHeight || window.innerHeight,
  };

  const frames: FrameInfo[] = [
    {
      frame_id: frameId,
      parent_frame_id: parentFrameId,
      origin: urlOrigin,
      path: urlPath,
      offset: frameOffset,
      accessible: true,
    },
  ];

  const rawElements = new Set<Element>();

  // Recursive collection of all nodes including those in shadow roots
  function collectNodes(root: Document | DocumentFragment | Element) {
    const children = root.querySelectorAll('*');
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (!el) continue;

      // Check for shadow root
      let sRoot: ShadowRoot | null = el.shadowRoot || null;
      if (!sRoot && typeof chrome !== 'undefined' && (chrome as any).dom?.openOrClosedShadowRoot) {
         try { sRoot = (chrome as any).dom.openOrClosedShadowRoot(el); } catch {}
      }
      
      if (sRoot) {
        collectNodes(sRoot);
      }

      // If already added, skip
      if (rawElements.has(el)) continue;

      let cached = elementCache.get(el);
      if (cached) {
        if (cached.isMeaningful) rawElements.add(el);
        continue;
      }

      let isMeaningful = false;
      
      try {
        if (el.matches && el.matches(CANDIDATE_SELECTOR)) {
          isMeaningful = true;
        }
      } catch {
        // Ignored
      }

      if (!isMeaningful) {
        const htmlEl = el as HTMLElement;
        if ((el as any).onclick || htmlEl.style?.cursor === 'pointer' || el.hasAttribute('onclick')) {
          isMeaningful = true;
        } else {
          // Catch plain divs/spans that contain direct text
          if (el.hasChildNodes()) {
            const childNodes = el.childNodes;
            for (let j = 0; j < childNodes.length; j++) {
              const child = childNodes[j];
              if (child && child.nodeType === Node.TEXT_NODE) {
                const text = child.nodeValue;
                if (text && text.trim().length > 0) {
                  isMeaningful = true;
                  break;
                }
              }
            }
          }

          if (!isMeaningful && el.children.length === 0) {
            const computed = window.getComputedStyle(el);
            if (computed.backgroundImage && computed.backgroundImage !== 'none' && computed.backgroundImage.includes('url(')) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 10 && rect.height > 10) {
                isMeaningful = true;
              }
            }
          }
        }
      }

      if (isMeaningful) {
        rawElements.add(el);
        elementCache.set(el, { isMeaningful: true });
      } else {
        elementCache.set(el, { isMeaningful: false });
      }
    }
  }

  collectNodes(document);

  // Filter out any agent UI host
  const filtered = Array.from(rawElements).filter(
    (el) => !el.closest('[data-agent-ui]') && el.id !== '__sih_agent_ui_host__'
  );

  const elements: DomElementInfo[] = [];

  for (const el of filtered) {
    let cached = elementCache.get(el);
    if (!cached) continue;
    
    if (!cached.domId) {
      cached.domId = `d${nextId++}`;
    }
    const domId = cached.domId;
    elementRegistry.register(domId, el);

    const rect = el.getBoundingClientRect();
    const bbox: [number, number, number, number] = [
      Math.round(rect.left + frameOffset[0]),
      Math.round(rect.top + frameOffset[1]),
      Math.round(rect.width),
      Math.round(rect.height),
    ];

    const visible = isElementVisible(el);
    const inViewport =
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= viewport.h &&
      rect.left <= viewport.w;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const occluded = isElementOccluded(el, cx, cy);
    

    if (!cached.staticInfo) {
      const tag = el.tagName.toLowerCase();
      const role = computeAriaRole(el);
      const name = computeElementAccessibleName(el);
      const aria = extractAriaStates(el);
      const { rendering, has_bg_image, handlers_hint } = detectRenderingKind(el);

      let inputInfo: any = undefined;
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const inputEl = el as HTMLInputElement;
        const type = (inputEl.type || 'text').toLowerCase();
        const isPassword = type === 'password';
        const hasValue = Boolean(inputEl.value && inputEl.value.length > 0);

        inputInfo = {
          type,
          autocomplete: inputEl.autocomplete || null,
          name: inputEl.name || null,
          placeholder: inputEl.placeholder || null,
          is_password: isPassword,
          has_value: hasValue,
          value: isPassword ? null : inputEl.value || null, 
        };
      }
      
      const attrs: Record<string, string> = {};
      const addAttr = (name: string) => {
        const val = el.getAttribute(name);
        if (val) attrs[name] = val;
      };
      addAttr('alt');
      addAttr('title');
      addAttr('aria-description');
      addAttr('label');
      addAttr('autocomplete');

      let extractedText = '';
      const piiMatches: { nodeIndex: number, start: number, end: number, text: string, type: string }[] = [];
      
      for (let j = 0; j < el.childNodes.length; j++) {
        const child = el.childNodes[j];
        if (child && child.nodeType === Node.TEXT_NODE) {
          const rawText = child.nodeValue || '';
          if (!rawText.trim()) {
            extractedText += rawText;
            continue;
          }

          let modifiedText = rawText;
          const matches: { start: number, end: number, text: string, type: string }[] = [];

          // Email
          for (const m of rawText.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
            matches.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: 'EMAIL' });
          }
          // Aadhaar
          for (const m of rawText.matchAll(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g)) {
            const clean = m[0].replace(/[\s-]/g, '');
            if (/^[2-9]\d{11}$/.test(clean)) {
              let c = 0;
              const VERHOEFF_D=[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
              const VERHOEFF_P=[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
              const digits = clean.split('').map(Number).reverse();
              let valid = true;
              for (let i = 0; i < digits.length; i++) {
                if (digits[i] === undefined) { valid = false; break; }
                c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![digits[i]!]!]!;
              }
              if (valid && c === 0) {
                matches.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: 'AADHAAR' });
              }
            }
          }
          // PAN
          for (const m of rawText.matchAll(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g)) {
            if (/^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(m[0].trim().toUpperCase())) {
              matches.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: 'PAN' });
            }
          }
          // Phone (10 digits)
          for (const m of rawText.matchAll(/(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/g)) {
            matches.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: 'PHONE' });
          }

          matches.sort((a, b) => b.start - a.start);

          for (const m of matches) {
            piiMatches.push({ nodeIndex: j, start: m.start, end: m.end, text: m.text, type: m.type });
            modifiedText = modifiedText.substring(0, m.start) + `<${m.type}>` + modifiedText.substring(m.end);
          }
          extractedText += modifiedText + ' ';
        }
      }

      const text = extractedText.trim().replace(/\s+/g, ' ').slice(0, 300);
      const classes = Array.from(el.classList);
      const enhanced = extractEnhancedDomMetadata(el);

      cached.staticInfo = {
        tag,
        role,
        name,
        aria,
        rendering,
        has_bg_image,
        handlers_hint,
        inputInfo,
        extractedText: text,
        classes,
        piiMatches,
        attributes: attrs,
        enhanced,
      };
    }

    const s = cached.staticInfo!;
    const interactable = visible && !s.aria.disabled && !occluded;

    // Evaluate PII bounds dynamically based on current viewport
    for (const m of s.piiMatches) {
      try {
        const child = el.childNodes[m.nodeIndex];
        if (child && child.nodeType === Node.TEXT_NODE) {
          const range = document.createRange();
          range.setStart(child, m.start);
          range.setEnd(child, m.end);
          const rects = range.getClientRects();
          
          for (let k = 0; k < rects.length; k++) {
            const rect = rects[k];
            if (rect && rect.width > 0 && rect.height > 0) {
              elements.push({
                dom_id: `pii_span_${nextPiiId++}`,
                frame_id: frameId,
                origin: urlOrigin,
                tag: 'span',
                role: null,
                name: null,
                text: m.text,
                bbox: [
                  Math.round(rect.left + frameOffset[0]),
                  Math.round(rect.top + frameOffset[1]),
                  Math.round(rect.width),
                  Math.round(rect.height),
                ],
                aria: {},
                visible: true,
                in_viewport: true,
                occluded: false,
                interactable: false,
                rendering: 'html',
                has_bg_image: false,
                handlers_hint: false,
                parent_dom_id: domId,
              });
            }
          }
        }
      } catch (e) {}
    }

    elements.push({
      dom_id: domId,
      frame_id: frameId,
      origin: urlOrigin,
      tag: s.tag,
      role: s.role,
      name: s.name,
      text: s.extractedText,
      classes: s.classes,
      aria: s.aria,
      input: s.inputInfo,
      attributes: s.attributes,
      bbox,
      visible,
      in_viewport: inViewport,
      occluded,
      interactable,
      rendering: s.rendering,
      has_bg_image: s.has_bg_image,
      handlers_hint: s.handlers_hint,
      parent_dom_id: null,
      element_id: s.enhanced.element_id,
      element_name: s.enhanced.element_name,
      label: s.enhanced.label,
      description: s.enhanced.description,
      aria_label: s.enhanced.aria_label,
      aria_labelledby: s.enhanced.aria_labelledby,
      aria_describedby: s.enhanced.aria_describedby,
      form_id: s.enhanced.form_id,
      stable_selector: s.enhanced.stable_selector,
    });
  }

  const pageStateHash = await computePageStateHash(
    urlOrigin,
    urlPath,
    frames,
    elements,
    window.scrollY
  );

  return {
    snapshot_id: `snap_${Date.now()}`,
    url_origin: urlOrigin,
    url_path: urlPath,
    frames,
    elements,
    viewport,
    dpr: window.devicePixelRatio || 1,
    scroll: { x: window.scrollX, y: window.scrollY },
    page_state_hash: pageStateHash,
    ts: Date.now(),
  };
}
