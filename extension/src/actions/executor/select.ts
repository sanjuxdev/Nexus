import { showActionHighlight } from '../../content/agent-ui.js';

export async function executeSelect(el: Element, optionTextOrValue: string): Promise<void> {
  const rect = el.getBoundingClientRect();
  showActionHighlight([rect.left, rect.top, rect.width, rect.height]);

  if (el.tagName.toLowerCase() === 'select') {
    const selectEl = el as HTMLSelectElement;
    let found = false;

    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      if (opt && (opt.value === optionTextOrValue || opt.text.trim() === optionTextOrValue.trim())) {
        selectEl.selectedIndex = i;
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error(`Option "${optionTextOrValue}" not found in select element`);
    }

    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // For custom dropdown controls, trigger click
    (el as HTMLElement).click();
  }
}
