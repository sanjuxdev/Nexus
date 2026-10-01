import type {
  DomElementInfo,
  DomSnapshot,
  PerceptionRegion,
  SemanticType,
  Source,
  VisualState,
} from '@contracts/index.js';

export function mapDomToSemanticType(el: DomElementInfo): SemanticType {
  if (el.role === 'button' || el.tag === 'button') return 'button';
  if (el.input) {
    if (el.input.type === 'checkbox') return 'checkbox';
    if (el.input.type === 'button' || el.input.type === 'submit') return 'button';
    return 'input';
  }
  if (el.role === 'link' || el.tag === 'a') return 'link';
  if (el.role === 'combobox' || el.tag === 'select') return 'dropdown';
  if (el.tag === 'img' || el.role === 'img') return 'image';
  if (el.role === 'dialog' || el.tag === 'dialog') return 'dialog';
  if (el.tag === 'table') return 'table';
  if (el.tag === 'nav' || el.role === 'navigation') return 'navigation';
  if (el.role === 'tab') return 'tab';
  if (el.role === 'menu' || el.role === 'menuitem') return 'menu';
  if (el.text && el.text.length > 0) return 'text';
  return 'unknown';
}

export function domElementToPerceptionRegion(
  el: DomElementInfo,
  snapshot: DomSnapshot
): PerceptionRegion {
  const sources: Source[] = ['DOM'];
  if (el.role || el.name) {
    sources.push('ARIA');
  }

  const states: VisualState[] = [];
  if (el.visible) states.push('visible');
  if (el.aria.disabled) states.push('disabled');
  else states.push('enabled');
  if (el.aria.selected) states.push('selected');
  if (el.aria.expanded) states.push('expanded');
  else if (el.aria.expanded === false) states.push('collapsed');
  if (el.aria.checked === true) states.push('checked');
  else if (el.aria.checked === false) states.push('unchecked');

  let text = el.name || el.text || el.input?.placeholder || null;
  if (el.input && !el.input.is_password && el.input.value && el.input.value.trim().length > 0) {
    if (el.name && el.name !== el.input.value) {
      text = `${el.name}: ${el.input.value}`;
    } else {
      text = el.input.value;
    }
  }

  // Phase 2: Add other attributes to the searchable text space
  if (el.attributes) {
    const attrVals = Object.values(el.attributes).filter(Boolean);
    if (attrVals.length > 0) {
      text = (text ? text + ' ' : '') + attrVals.join(' ');
    }
  }

  return {
    region_id: '', // Minted by assembleFrame()
    local_key: el.dom_id,
    source: sources,
    semantic_type: mapDomToSemanticType(el),
    text,
    bbox: el.bbox,
    confidence: 0.95,
    visible: el.visible,
    interactable: el.interactable,
    visual_state: states,
    dom_ref: {
      dom_id: el.dom_id,
      role: el.role,
      tag: el.tag,
    },
    route: 'HIGH',
    sensitivity: 'unclassified',
    origin: el.origin,
    frame_id: el.frame_id,
    page_state_hash: snapshot.page_state_hash,
    timestamp: snapshot.ts,
  };
}
