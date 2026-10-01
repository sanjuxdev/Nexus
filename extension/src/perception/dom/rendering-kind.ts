export type RenderingKind =
  | 'html'
  | 'canvas'
  | 'svg'
  | 'img'
  | 'video'
  | 'iframe'
  | 'shadow_open'
  | 'shadow_closed'
  | 'custom';

export function detectRenderingKind(el: Element): {
  rendering: RenderingKind;
  has_bg_image: boolean;
  handlers_hint: boolean;
} {
  const tag = el.tagName.toLowerCase();

  let rendering: RenderingKind = 'html';
  if (tag === 'canvas') rendering = 'canvas';
  else if (tag === 'svg' || tag === 'path') rendering = 'svg';
  else if (tag === 'img') rendering = 'img';
  else if (tag === 'video') rendering = 'video';
  else if (tag === 'iframe') rendering = 'iframe';
  else if (el.shadowRoot) rendering = 'shadow_open';

  let has_bg_image = false;
  let handlers_hint = false;

  if (typeof window !== 'undefined') {
    const style = window.getComputedStyle(el);
    if (style.backgroundImage && style.backgroundImage !== 'none') {
      has_bg_image = true;
    }
    if (style.cursor === 'pointer') {
      handlers_hint = true;
    }
  }

  if (
    (el as any).onclick ||
    el.getAttribute('onclick') ||
    el.getAttribute('role') === 'button'
  ) {
    handlers_hint = true;
  }

  return { rendering, has_bg_image, handlers_hint };
}
