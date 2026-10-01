/**
 * Phase 1: DOM / ARIA Perception Contract
 * 
 * Extracts rich accessibility and DOM identity metadata:
 * - Role & Accessible name / description
 * - Associated <label> text and label references
 * - Form association (form id/name)
 * - Raw ARIA attributes (aria-label, aria-labelledby, aria-describedby)
 * - Native identification (id, name, type, placeholder, autocomplete)
 * - Stable DOM selector
 */

export interface EnhancedDomMetadata {
  element_id: string | null;
  element_name: string | null;
  label: string | null;
  description: string | null;
  aria_label: string | null;
  aria_labelledby: string | null;
  aria_describedby: string | null;
  form_id: string | null;
  stable_selector: string;
}

import { resolveAriaMetadata } from '../accessibility/aria-resolver.js';

/**
 * Resolves associated label for an input or control:
 * 1. aria-labelledby target elements
 * 2. Explicit <label for="id"> / enclosing <label>
 * 3. aria-label
 */
export function resolveAssociatedLabel(el: Element): string | null {
  try {
    const meta = resolveAriaMetadata(el);
    if (meta.nameSource === 'aria-labelledby' || meta.nameSource === 'label' || meta.nameSource === 'aria-label') {
      return meta.name;
    }
  } catch {
    // Fail-safe in restricted or unusual DOM environments
  }

  return null;
}

/**
 * Resolves accessible description:
 * 1. aria-describedby references
 * 2. aria-description attribute
 * 3. title attribute
 */
export function computeElementDescription(el: Element): string | null {
  try {
    const meta = resolveAriaMetadata(el);
    return meta.description;
  } catch {
    // Fail-safe
  }

  return null;
}

/**
 * Resolves form association (id of enclosing or referenced form).
 */
export function resolveFormAssociation(el: Element): string | null {
  try {
    const formAttr = el.getAttribute('form');
    if (formAttr) return formAttr;

    const formEl = el.closest('form');
    if (formEl) {
      return formEl.id || formEl.getAttribute('name') || 'form';
    }
  } catch {
    // Fail-safe
  }
  return null;
}

/**
 * Computes a deterministic, stable CSS selector identifying the element across re-renders.
 */
export function computeStableSelector(el: Element): string {
  try {
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return `#${el.id}`;
    }

    const name = el.getAttribute('name');
    if (name) {
      return `${tag}[name="${name}"]`;
    }

    const role = el.getAttribute('role');
    if (role) {
      return `${tag}[role="${role}"]`;
    }

    // Build short path from parent
    const parent = el.parentElement;
    if (parent) {
      const parentTag = parent.tagName.toLowerCase();
      const parentId = parent.id ? `#${parent.id}` : parentTag;
      const index = Array.from(parent.children).indexOf(el) + 1;
      return `${parentId} > ${tag}:nth-child(${index})`;
    }

    return tag;
  } catch {
    return el.tagName ? el.tagName.toLowerCase() : 'unknown';
  }
}

/**
 * Aggregates all Phase 1 enhanced DOM/ARIA metadata for an element.
 */
export function extractEnhancedDomMetadata(el: Element): EnhancedDomMetadata {
  const element_id = el.id ? el.id : null;
  const element_name = el.getAttribute('name') || null;
  const aria_label = el.getAttribute('aria-label') || null;
  const aria_labelledby = el.getAttribute('aria-labelledby') || null;
  const aria_describedby = el.getAttribute('aria-describedby') || null;
  const label = resolveAssociatedLabel(el);
  const description = computeElementDescription(el);
  const form_id = resolveFormAssociation(el);
  const stable_selector = computeStableSelector(el);

  return {
    element_id,
    element_name,
    label,
    description,
    aria_label,
    aria_labelledby,
    aria_describedby,
    form_id,
    stable_selector,
  };
}
