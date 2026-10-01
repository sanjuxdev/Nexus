// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveAriaMetadata,
  resolveIdReferences,
  resolveHtmlLabels,
  resolveNativeSemantics,
} from '../../extension/src/perception/accessibility/aria-resolver.js';
import { computeElementAccessibleName } from '../../extension/src/perception/accessibility/name.js';
import { extractDomSnapshot } from '../../extension/src/perception/dom/snapshot.js';

describe('Phase 2: Accessible Name & ARIA Resolution Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('1. Resolves multiple space-separated aria-labelledby references', () => {
    document.body.innerHTML = `
      <span id="prefix">Mr.</span>
      <span id="first">John</span>
      <span id="last">Doe</span>
      <input id="target" aria-labelledby="prefix first last" />
    `;
    const target = document.getElementById('target')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Mr. John Doe');
    expect(meta.nameSource).toBe('aria-labelledby');
    expect(meta.referencedIds).toEqual(['prefix', 'first', 'last']);
    expect(computeElementAccessibleName(target)).toBe('Mr. John Doe');
  });

  it('2. Handles missing/broken IDs in aria-labelledby gracefully', () => {
    document.body.innerHTML = `
      <span id="valid-part">Personal</span>
      <input id="target" aria-labelledby="non-existent-1 valid-part non-existent-2" />
    `;
    const target = document.getElementById('target')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Personal');
    expect(meta.nameSource).toBe('aria-labelledby');
    expect(meta.referencedIds).toEqual(['valid-part']);
  });

  it('3. Resolves hidden elements referenced by aria-labelledby and flags hasHiddenReference', () => {
    document.body.innerHTML = `
      <div id="hidden-label" style="display: none;">Confidential Account</div>
      <span id="visible-part">Number</span>
      <input id="target" aria-labelledby="hidden-label visible-part" />
    `;
    const target = document.getElementById('target')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Confidential Account Number');
    expect(meta.nameSource).toBe('aria-labelledby');
    expect(meta.hasHiddenReference).toBe(true);
    expect(meta.referencedIds).toEqual(['hidden-label', 'visible-part']);
  });

  it('4. Enforces precedence: aria-labelledby overrides aria-label, <label>, and placeholder', () => {
    document.body.innerHTML = `
      <span id="override-label">Top Priority</span>
      <label for="target">Form Label</label>
      <input
        id="target"
        aria-labelledby="override-label"
        aria-label="Ignored Aria Label"
        placeholder="Ignored Placeholder"
      />
    `;
    const target = document.getElementById('target')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Top Priority');
    expect(meta.nameSource).toBe('aria-labelledby');
  });

  it('5. Enforces precedence: aria-label overrides <label> and native semantics', () => {
    document.body.innerHTML = `
      <label for="target">Standard Label</label>
      <input id="target" aria-label="Aria Label Override" placeholder="Fallback Placeholder" />
    `;
    const target = document.getElementById('target')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Aria Label Override');
    expect(meta.nameSource).toBe('aria-label');
  });

  it('6. Resolves multiple <label for="..."> elements associated with the same input', () => {
    document.body.innerHTML = `
      <label for="user-age">Age</label>
      <input id="user-age" type="number" />
      <label for="user-age">(in years)</label>
    `;
    const target = document.getElementById('user-age')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Age (in years)');
    expect(meta.nameSource).toBe('label');
  });

  it('7. Extracts enclosing <label> text while cleanly stripping nested form controls', () => {
    document.body.innerHTML = `
      <label id="container-label">
        Subscribe to newsletter
        <input id="checkbox-news" type="checkbox" checked />
        <span class="fine-print">(monthly digest)</span>
      </label>
    `;
    const target = document.getElementById('checkbox-news')!;
    const meta = resolveAriaMetadata(target);

    expect(meta.name).toBe('Subscribe to newsletter (monthly digest)');
    expect(meta.nameSource).toBe('label');
  });

  it('8. Resolves native HTML semantics for inputs, buttons, fieldsets, and tables', () => {
    document.body.innerHTML = `
      <input id="submit-btn" type="submit" value="Send Form" />
      <img id="logo-img" alt="Company Logo" src="logo.png" />
      <fieldset id="group-set">
        <legend>Contact Information</legend>
        <input type="text" />
      </fieldset>
      <table id="data-table">
        <caption>Quarterly Revenue 2026</caption>
        <tr><td>Data</td></tr>
      </table>
      <details id="details-el">
        <summary>More Info</summary>
        <p>Details here</p>
      </details>
    `;
    const submitBtn = document.getElementById('submit-btn')!;
    const logoImg = document.getElementById('logo-img')!;
    const fieldset = document.getElementById('group-set')!;
    const table = document.getElementById('data-table')!;
    const details = document.getElementById('details-el')!;

    expect(resolveNativeSemantics(submitBtn)).toBe('Send Form');
    expect(resolveNativeSemantics(logoImg)).toBe('Company Logo');
    expect(resolveNativeSemantics(fieldset)).toBe('Contact Information');
    expect(resolveNativeSemantics(table)).toBe('Quarterly Revenue 2026');
    expect(resolveNativeSemantics(details)).toBe('More Info');
  });

  it('9. Resolves placeholder and title fallbacks in exact hierarchy order', () => {
    document.body.innerHTML = `
      <input id="with-ph-only" placeholder="Search products..." />
      <input id="with-title-only" title="Help Tooltip" />
      <input id="with-both" placeholder="Search products..." title="Product Search Tooltip" />
    `;
    const withPhOnly = document.getElementById('with-ph-only')!;
    const withTitleOnly = document.getElementById('with-title-only')!;
    const withBoth = document.getElementById('with-both')!;

    // 1. Placeholder-only: name is placeholder, nameSource is 'placeholder'
    const metaPhOnly = resolveAriaMetadata(withPhOnly);
    expect(metaPhOnly.name).toBe('Search products...');
    expect(metaPhOnly.nameSource).toBe('placeholder');
    expect(metaPhOnly.description).toBeNull();

    // 2. Title-only: name is title, nameSource is 'title', title not reused as description
    const metaTitleOnly = resolveAriaMetadata(withTitleOnly);
    expect(metaTitleOnly.name).toBe('Help Tooltip');
    expect(metaTitleOnly.nameSource).toBe('title');
    expect(metaTitleOnly.description).toBeNull();

    // 3. Both title and placeholder: per W3C HTML-AAM, title takes precedence for name,
    // and placeholder serves as description fallback
    const metaBoth = resolveAriaMetadata(withBoth);
    expect(metaBoth.name).toBe('Product Search Tooltip');
    expect(metaBoth.nameSource).toBe('title');
    expect(metaBoth.description).toBe('Search products...');
    expect(metaBoth.descriptionSource).toBe('placeholder');
  });

  it('10. Resolves multi-ID aria-describedby and description hierarchy', () => {
    document.body.innerHTML = `
      <span id="desc-1">Minimum 8 characters.</span>
      <span id="desc-2">Must include a number.</span>
      <input id="pwd" type="password" aria-describedby="desc-1 desc-2" />
    `;
    const pwd = document.getElementById('pwd')!;
    const meta = resolveAriaMetadata(pwd);

    expect(meta.description).toBe('Minimum 8 characters. Must include a number.');
    expect(meta.descriptionSource).toBe('aria-describedby');
    expect(meta.referencedIds).toEqual(['desc-1', 'desc-2']);
  });

  it('11. End-to-end integration: snapshot elements correctly receive Phase 2 ARIA metadata', async () => {
    document.body.innerHTML = `
      <div id="wrapper">
        <label for="full-input">Billing Name</label>
        <span id="billing-hint">As printed on your card</span>
        <input
          id="full-input"
          type="text"
          aria-describedby="billing-hint"
          autocomplete="cc-name"
        />
      </div>
    `;
    const snapshot = await extractDomSnapshot('main');
    const inputEl = snapshot.elements.find((e) => e.element_id === 'full-input');

    expect(inputEl).toBeDefined();
    expect(inputEl?.name).toBe('Billing Name');
    expect(inputEl?.label).toBe('Billing Name');
    expect(inputEl?.description).toBe('As printed on your card');
    expect(inputEl?.aria_describedby).toBe('billing-hint');
  });
});
