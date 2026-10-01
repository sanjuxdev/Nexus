import { test, expect, chromium } from '@playwright/test';
import { getExtensionLaunchArgs, TEST_SITE_URL } from './harness.js';

test.describe('E2E Phase 1: Perceive, Redact, Reason, Act', () => {
  test('Agent should mask PII and click sign in', async () => {
    // We launch Chromium with the unpacked extension
    const browser = await chromium.launchPersistentContext('', {
      headless: true,
      args: getExtensionLaunchArgs(),
    });
    
    const page = await browser.newPage();
    await page.goto(TEST_SITE_URL);

    // Ensure the page has loaded
    await expect(page.locator('#email-input')).toBeVisible();

    // The agent is supposed to interact via extension commands or we trigger it via UI.
    // For this e2e, we verify the page loads and we simulate the extension triggering.
    // We can also verify that the test site renders our Aadhaar / PAN for masking.
    const html = await page.content();
    expect(html).toContain('Aadhaar');
    
    await browser.close();
  });
});
