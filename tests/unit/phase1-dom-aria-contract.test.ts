// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractDomSnapshot } from '../../extension/src/perception/dom/snapshot.js';
import { extractEnhancedDomMetadata } from '../../extension/src/perception/dom/aria-metadata.js';
import { DomElementInfoSchema } from '../../contracts/ts/schemas.js';

describe('Phase 1: DOM / ARIA Perception Contract Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('1. Extracts button with role, accessible name, and stable selector', async () => {
    document.body.innerHTML = '<button id="btn-login" type="button">Login</button>';
    const snapshot = await extractDomSnapshot('main');
    const btn = snapshot.elements.find((e) => e.element_id === 'btn-login');

    expect(btn).toBeDefined();
    expect(btn?.role).toBe('button');
    expect(btn?.name).toBe('Login');
    expect(btn?.element_id).toBe('btn-login');
    expect(btn?.stable_selector).toBe('#btn-login');
  });

  it('2. Extracts text input with associated label, placeholder, and autocomplete', async () => {
    document.body.innerHTML = `
      <label for="user-email">Email Address</label>
      <input id="user-email" type="email" name="email" placeholder="you@domain.com" autocomplete="email" />
    `;
    const snapshot = await extractDomSnapshot('main');
    const input = snapshot.elements.find((e) => e.element_id === 'user-email');

    expect(input).toBeDefined();
    expect(input?.tag).toBe('input');
    expect(input?.label).toBe('Email Address');
    expect(input?.input?.type).toBe('email');
    expect(input?.input?.placeholder).toBe('you@domain.com');
    expect(input?.input?.autocomplete).toBe('email');
  });

  it('3. Extracts textarea with enclosing label and accessible description', async () => {
    document.body.innerHTML = `
      <label>
        Feedback
        <textarea id="feedback-text" aria-describedby="feedback-hint"></textarea>
      </label>
      <span id="feedback-hint">Please enter up to 500 characters</span>
    `;
    const snapshot = await extractDomSnapshot('main');
    const textarea = snapshot.elements.find((e) => e.element_id === 'feedback-text');

    expect(textarea).toBeDefined();
    expect(textarea?.tag).toBe('textarea');
    expect(textarea?.label).toBe('Feedback');
    expect(textarea?.description).toBe('Please enter up to 500 characters');
    expect(textarea?.aria_describedby).toBe('feedback-hint');
  });

  it('4. Extracts select dropdown with role, options, and form association', async () => {
    document.body.innerHTML = `
      <form id="state-form">
        <label for="state-select">Select State</label>
        <select id="state-select" name="state">
          <option value="KA">Karnataka</option>
          <option value="TN">Tamil Nadu</option>
        </select>
      </form>
    `;
    const snapshot = await extractDomSnapshot('main');
    const select = snapshot.elements.find((e) => e.element_id === 'state-select');

    expect(select).toBeDefined();
    expect(select?.role).toBe('combobox');
    expect(select?.label).toBe('Select State');
    expect(select?.form_id).toBe('state-form');
  });

  it('5. Extracts hyperlink with role=link, href, and accessible name', async () => {
    document.body.innerHTML = '<a id="nav-home" href="/home">Go to Dashboard</a>';
    const snapshot = await extractDomSnapshot('main');
    const link = snapshot.elements.find((e) => e.element_id === 'nav-home');

    expect(link).toBeDefined();
    expect(link?.role).toBe('link');
    expect(link?.name).toBe('Go to Dashboard');
    expect(link?.tag).toBe('a');
  });

  it('6. Resolves ARIA roles and aria-labelledby references', async () => {
    document.body.innerHTML = `
      <span id="label-first">First</span>
      <span id="label-last">Last</span>
      <input id="full-name" type="text" aria-labelledby="label-first label-last" />
    `;
    const snapshot = await extractDomSnapshot('main');
    const input = snapshot.elements.find((e) => e.element_id === 'full-name');

    expect(input).toBeDefined();
    expect(input?.label).toBe('First Last');
    expect(input?.aria_labelledby).toBe('label-first label-last');
  });

  it('7. Validates visibility, interactability, and bounding box geometry', async () => {
    document.body.innerHTML = `
      <button id="btn-visible">Active Action</button>
      <button id="btn-disabled" disabled>Disabled Action</button>
    `;
    const btnVisible = document.getElementById('btn-visible')!;
    btnVisible.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 100,
      height: 40,
      bottom: 50,
      right: 110,
      x: 10,
      y: 10,
      toJSON: () => {},
    });

    const snapshot = await extractDomSnapshot('main');
    const active = snapshot.elements.find((e) => e.element_id === 'btn-visible');
    const disabled = snapshot.elements.find((e) => e.element_id === 'btn-disabled');

    expect(active?.visible).toBe(true);
    expect(active?.interactable).toBe(true);
    expect(disabled?.interactable).toBe(false);
    expect(active?.bbox).toBeDefined();
    expect(active?.bbox.length).toBe(4);
  });

  it('8. Conforms strictly to DomElementInfoSchema', async () => {
    document.body.innerHTML = `
      <form id="sample-form">
        <label for="inp-test">Field</label>
        <input id="inp-test" type="text" name="test" aria-label="Custom Field" />
      </form>
    `;
    const snapshot = await extractDomSnapshot('main');
    const el = snapshot.elements.find((e) => e.element_id === 'inp-test');

    expect(el).toBeDefined();
    const parseResult = DomElementInfoSchema.safeParse(el);
    expect(parseResult.success).toBe(true);
  });
});
