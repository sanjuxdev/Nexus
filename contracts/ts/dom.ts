import type { BBox, FrameId, Origin } from './common.js';

export interface FrameInfo {
  frame_id: FrameId;
  parent_frame_id: FrameId | null;
  origin: Origin;
  path: string;
  offset: [number, number]; // frame origin in top-viewport CSS px
  accessible: boolean; // false = we could not inject → treat region as LOW
}

export interface DomElementInfo {
  dom_id: string; // "d12", unique within one snapshot
  frame_id: FrameId;
  origin: Origin;
  tag: string;
  role: string | null;
  name: string | null; // computed accessible name (raw — local zone only)
  text: string; // visible text, ≤300 chars (raw — local zone only)
  aria: {
    expanded?: boolean;
    checked?: boolean | 'mixed';
    disabled?: boolean;
    selected?: boolean;
    pressed?: boolean;
    hidden?: boolean;
  };
  classes?: string[];
  input?: {
    type: string;
    autocomplete: string | null;
    name: string | null;
    placeholder: string | null;
    is_password: boolean;
    has_value: boolean;
    value: string | null; // value is ALWAYS null for password inputs
  };
  attributes?: Record<string, string>; // Phase 2: additional PII signals
  bbox: BBox;
  visible: boolean;
  in_viewport: boolean;
  occluded: boolean;
  interactable: boolean;
  rendering:
    | 'html'
    | 'canvas'
    | 'svg'
    | 'img'
    | 'video'
    | 'iframe'
    | 'shadow_open'
    | 'shadow_closed'
    | 'custom';
  has_bg_image: boolean;
  handlers_hint: boolean;
  parent_dom_id: string | null;
  // Phase 1: DOM / ARIA Perception Contract Extensions
  element_id?: string | null;
  element_name?: string | null;
  label?: string | null;
  description?: string | null;
  aria_label?: string | null;
  aria_labelledby?: string | null;
  aria_describedby?: string | null;
  form_id?: string | null;
  stable_selector?: string | null;
}

export interface DomSnapshot {
  snapshot_id: string;
  url_origin: Origin;
  url_path: string; // query/fragment already stripped
  frames: FrameInfo[];
  elements: DomElementInfo[];
  viewport: { w: number; h: number };
  dpr: number;
  scroll: { x: number; y: number };
  page_state_hash: string;
  ts: number;
}

export interface DirtyEvent {
  reason: 'mutation' | 'scroll' | 'resize' | 'navigation' | 'overlay' | 'layout' | 'visual';
  bbox: BBox | null;
  frame_id: FrameId;
  ts: number;
}
