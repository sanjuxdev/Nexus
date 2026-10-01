export function computeAriaRole(el: Element): string | null {
  // Explicit role
  const explicitRole = el.getAttribute('role');
  if (explicitRole) {
    return explicitRole.trim().split(/\s+/)[0] || null;
  }

  // Implicit HTML5 role mapping
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'input': {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      return 'textbox';
    }
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'img':
      return 'img';
    case 'nav':
      return 'navigation';
    case 'dialog':
      return 'dialog';
    default:
      return null;
  }
}

export function extractAriaStates(el: Element): {
  expanded?: boolean;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  selected?: boolean;
  pressed?: boolean;
  hidden?: boolean;
} {
  const aria: {
    expanded?: boolean;
    checked?: boolean | 'mixed';
    disabled?: boolean;
    selected?: boolean;
    pressed?: boolean;
    hidden?: boolean;
  } = {};

  if (el.hasAttribute('aria-expanded')) {
    aria.expanded = el.getAttribute('aria-expanded') === 'true';
  }
  if (el.hasAttribute('aria-checked')) {
    const val = el.getAttribute('aria-checked');
    aria.checked = val === 'mixed' ? 'mixed' : val === 'true';
  }
  if (el.hasAttribute('aria-disabled') || (el as any).disabled) {
    aria.disabled = el.getAttribute('aria-disabled') === 'true' || (el as any).disabled === true;
  }
  if (el.hasAttribute('aria-selected')) {
    aria.selected = el.getAttribute('aria-selected') === 'true';
  }
  if (el.hasAttribute('aria-pressed')) {
    aria.pressed = el.getAttribute('aria-pressed') === 'true';
  }
  if (el.hasAttribute('aria-hidden')) {
    aria.hidden = el.getAttribute('aria-hidden') === 'true';
  }

  return aria;
}
