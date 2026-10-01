import { computeAccessibleName } from 'dom-accessibility-api';

/**
 * Phase 2: Accessible Name & ARIA Resolution
 * 
 * Implements reliable resolution of:
 * - aria-label
 * - aria-labelledby (single and multiple space-separated references, including hidden targets)
 * - aria-describedby (single and multiple space-separated references, including hidden targets)
 * - <label for="..."> (including multiple associated labels)
 * - Enclosing <label> (nested elements, subtrees)
 * - Native HTML semantics (button text, input value, img alt, fieldset legend, table caption)
 * - Placeholder & title fallbacks
 * - Handling of missing, broken, circular, or conflicting references
 */

export interface AriaResolutionResult {
  name: string | null;
  nameSource: 'aria-labelledby' | 'aria-label' | 'label' | 'native' | 'title' | 'placeholder' | null;
  description: string | null;
  descriptionSource: 'aria-describedby' | 'aria-description' | 'title' | 'placeholder' | null;
  hasHiddenReference: boolean;
  referencedIds: string[];
}

/**
 * Extracts visible or referenced text from an element, including hidden referenced nodes.
 * Safeguarded against circular DOM references with a visited set.
 */
function getElementFlattenedText(el: Element, visited = new Set<Element>()): string {
  if (visited.has(el)) return '';
  visited.add(el);

  let text = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (!node) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const childEl = node as Element;
      const tag = childEl.tagName.toLowerCase();
      // Skip embedded controls to avoid double counting input text
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        const inputVal = (childEl as HTMLInputElement).value;
        if (inputVal && (childEl as HTMLInputElement).type !== 'password') {
          text += ' ' + inputVal;
        }
      } else {
        text += ' ' + getElementFlattenedText(childEl, visited);
      }
    }
  }

  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Resolves space-separated ID references (e.g. for aria-labelledby, aria-describedby)
 * Handles multiple references, missing/invalid IDs, and hidden elements gracefully.
 */
export function resolveIdReferences(
  idList: string | null | undefined,
  contextDoc?: Document
): { text: string | null; foundIds: string[]; hasHidden: boolean } {
  if (!idList || typeof idList !== 'string') {
    return { text: null, foundIds: [], hasHidden: false };
  }

  const ids = idList.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) {
    return { text: null, foundIds: [], hasHidden: false };
  }

  const doc = contextDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    return { text: null, foundIds: [], hasHidden: false };
  }

  const parts: string[] = [];
  const foundIds: string[] = [];
  let hasHidden = false;

  for (const id of ids) {
    try {
      const target = doc.getElementById(id);
      if (!target) {
        // Missing / invalid reference: skip gracefully without failing
        continue;
      }

      foundIds.push(id);

      // Check if reference is hidden
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        try {
          const style = window.getComputedStyle(target);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            target.hasAttribute('hidden') ||
            target.getAttribute('aria-hidden') === 'true'
          ) {
            hasHidden = true;
          }
        } catch {
          if (target.hasAttribute('hidden') || target.getAttribute('aria-hidden') === 'true') {
            hasHidden = true;
          }
        }
      } else {
        if (target.hasAttribute('hidden') || target.getAttribute('aria-hidden') === 'true') {
          hasHidden = true;
        }
      }

      const content = getElementFlattenedText(target);
      if (content) {
        parts.push(content);
      }
    } catch {
      // Ignore reference resolution errors
    }
  }

  const combined = parts.join(' ').trim().replace(/\s+/g, ' ');
  return {
    text: combined.length > 0 ? combined : null,
    foundIds,
    hasHidden,
  };
}

/**
 * Resolves all associated HTML <label> elements:
 * - <label for="id"> (supports multiple labels pointing to same id)
 * - Closest enclosing <label>
 */
export function resolveHtmlLabels(el: Element, contextDoc?: Document): string | null {
  const doc = contextDoc || el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  const parts: string[] = [];

  // 1. Explicit <label for="...">
  if (el.id) {
    try {
      const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id.replace(/["\\]/g, '\\$&');
      const matchingLabels = doc.querySelectorAll(`label[for="${safeId}"]`);
      matchingLabels.forEach((lbl) => {
        const text = getElementFlattenedText(lbl);
        if (text) parts.push(text);
      });
    } catch {
      // Fallback if selector fails
    }
  }

  // 2. Enclosing <label> ancestor
  if (parts.length === 0) {
    try {
      const enclosing = el.closest('label');
      if (enclosing) {
        // Clone and remove this control to extract only the surrounding label text
        const clone = enclosing.cloneNode(true) as HTMLElement;
        const controls = clone.querySelectorAll('input, select, textarea, button');
        controls.forEach((c) => c.remove());
        const text = clone.textContent?.trim().replace(/\s+/g, ' ');
        if (text) parts.push(text);
      }
    } catch {
      // Fallback
    }
  }

  const result = parts.join(' ').trim().replace(/\s+/g, ' ');
  return result.length > 0 ? result : null;
}

/**
 * Resolves native HTML element semantics:
 * - <input type="button|submit|reset" value="...">
 * - <img alt="...">
 * - <fieldset> -> <legend>
 * - <table> -> <caption>
 * - <details> -> <summary>
 * - <a> -> text
 */
export function resolveNativeSemantics(el: Element): string | null {
  const tag = el.tagName.toLowerCase();

  if (tag === 'input') {
    const input = el as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();
    if (type === 'button' || type === 'submit' || type === 'reset') {
      if (input.value && input.value.trim()) {
        return input.value.trim();
      }
    }
  }

  if (tag === 'img' || tag === 'area') {
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
  }

  if (tag === 'fieldset') {
    const legend = el.querySelector('legend');
    if (legend && legend.textContent) {
      const text = legend.textContent.trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }

  if (tag === 'table') {
    const caption = el.querySelector('caption');
    if (caption && caption.textContent) {
      const text = caption.textContent.trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }

  if (tag === 'details') {
    const summary = el.querySelector('summary');
    if (summary && summary.textContent) {
      const text = summary.textContent.trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }

  if (tag === 'button' || tag === 'a') {
    const text = getElementFlattenedText(el);
    if (text) return text;
  }

  return null;
}

/**
 * Full Phase 2 Accessible Name & Description Resolver.
 * Strict W3C precedence hierarchy:
 * 1. aria-labelledby
 * 2. aria-label
 * 3. <label> association (HTML for= or enclosing)
 * 4. Native HTML semantics
 * 5. placeholder
 * 6. title
 */
export function resolveAriaMetadata(el: Element, contextDoc?: Document): AriaResolutionResult {
  const doc = contextDoc || el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  let name: string | null = null;
  let nameSource: AriaResolutionResult['nameSource'] = null;
  let hasHiddenRef = false;
  const referencedIds: string[] = [];

  // Step 1: aria-labelledby
  const labelledByAttr = el.getAttribute('aria-labelledby');
  if (labelledByAttr && doc) {
    const res = resolveIdReferences(labelledByAttr, doc);
    if (res.text) {
      name = res.text;
      nameSource = 'aria-labelledby';
      if (res.hasHidden) hasHiddenRef = true;
      referencedIds.push(...res.foundIds);
    }
  }

  // Step 2: aria-label (if not resolved by aria-labelledby)
  if (!name) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      name = ariaLabel.trim();
      nameSource = 'aria-label';
    }
  }

  // Step 3: <label> associations
  if (!name) {
    const labelText = resolveHtmlLabels(el, doc);
    if (labelText) {
      name = labelText;
      nameSource = 'label';
    }
  }

  // Step 4: Native semantics (buttons, inputs, links, fieldsets, tables, details)
  if (!name) {
    const native = resolveNativeSemantics(el);
    if (native) {
      name = native;
      nameSource = 'native';
    }
  }

  // Step 5: dom-accessibility-api resolution
  if (!name) {
    try {
      const computed = computeAccessibleName(el);
      if (computed && computed.trim()) {
        const trimmed = computed.trim();
        const titleAttr = el.getAttribute('title')?.trim();
        const phAttr = el.getAttribute('placeholder')?.trim();
        name = trimmed;
        if (titleAttr && trimmed === titleAttr) {
          nameSource = 'title';
        } else if (phAttr && trimmed === phAttr) {
          nameSource = 'placeholder';
        } else {
          nameSource = 'native';
        }
      }
    } catch {
      // Fallback
    }
  }

  // Step 6: title (W3C HTML-AAM step 2D)
  if (!name) {
    const title = el.getAttribute('title');
    if (title && title.trim()) {
      name = title.trim();
      nameSource = 'title';
    }
  }

  // Step 7: placeholder (W3C HTML-AAM step 2E)
  if (!name) {
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
      name = placeholder.trim();
      nameSource = 'placeholder';
    }
  }

  // Accessible Description Resolution (aria-describedby > aria-description > title > placeholder)
  let description: string | null = null;
  let descriptionSource: AriaResolutionResult['descriptionSource'] = null;

  const describedByAttr = el.getAttribute('aria-describedby');
  if (describedByAttr && doc) {
    const res = resolveIdReferences(describedByAttr, doc);
    if (res.text) {
      description = res.text;
      descriptionSource = 'aria-describedby';
      if (res.hasHidden) hasHiddenRef = true;
      referencedIds.push(...res.foundIds);
    }
  }

  if (!description) {
    const ariaDesc = el.getAttribute('aria-description');
    if (ariaDesc && ariaDesc.trim()) {
      description = ariaDesc.trim();
      descriptionSource = 'aria-description';
    }
  }

  // Use title as description ONLY if not already used as name
  if (!description && nameSource !== 'title') {
    const title = el.getAttribute('title');
    if (title && title.trim()) {
      description = title.trim();
      descriptionSource = 'title';
    }
  }

  // Use placeholder as description fallback ONLY if not already used as name
  if (!description && nameSource !== 'placeholder') {
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
      description = placeholder.trim();
      descriptionSource = 'placeholder';
    }
  }

  return {
    name,
    nameSource,
    description,
    descriptionSource,
    hasHiddenReference: hasHiddenRef,
    referencedIds,
  };
}
