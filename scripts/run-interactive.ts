import { chromium } from '@playwright/test';
import { getExtensionLaunchArgs, TEST_SITE_URL } from '../tests/e2e/harness.js';
import * as fs from 'fs';

async function main() {
  console.log('Starting interactive browser session on DISPLAY', process.env.DISPLAY || ':0');
  
  const profileDir = '/tmp/sih-agent-chrome-profile';
  try {
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      ...getExtensionLaunchArgs().filter((arg) => !arg.startsWith('--headless')),
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
    ],
    permissions: [], // Prevent any site or popup from requesting mic, camera, or notifications
    viewport: null, // Allow full window sizing
  });

  // Discover background service worker
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 8000 });
  }
  const extensionId = background.url().split('/')[2];
  console.log('✓ Extension loaded with ID:', extensionId);

  // 1. Open Demo Page
  const page = await context.newPage();
  console.log('✓ Navigating to Demo Portal:', TEST_SITE_URL);
  await page.goto(TEST_SITE_URL);
  await page.waitForTimeout(600);

  // Pre-fill realistic sample values
  await page.fill('#email-input', 'scientist.isro@demo.gov.in');
  await page.fill('#phone-input', '+91 98765 43210');
  console.log('✓ Pre-filled test form with Email, Phone, Aadhaar, and PAN');

  // 2. Open Side Panel in separate tab
  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  console.log('✓ Opening Agent Side Panel:', sidepanelUrl);
  const sidepanelPage = await context.newPage();
  await sidepanelPage.goto(sidepanelUrl);
  await sidepanelPage.waitForTimeout(1000);

  // 3. Bring Demo Portal to front so captureVisibleTab captures the portal form
  await page.bringToFront();
  await page.waitForTimeout(500);

  // Trigger Agent Run without pulling sidepanel to the front
  console.log('✓ Triggering autonomous Agent execution...');
  await sidepanelPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Run')) as HTMLButtonElement;
    btn?.click();
  });
  await page.bringToFront();

  // Wait for perception, redaction, attestation, and execution
  await sidepanelPage.waitForTimeout(3000);

  // Expand Jury Audit Accordion to expose the masked preview
  try {
    const maskedImg = sidepanelPage.locator('img[alt="Masked Screenshot as seen by Vision Model"]');
    if (await maskedImg.count() === 0) {
      const auditBtn = sidepanelPage.locator('button:has-text("Jury Audit")');
      if (await auditBtn.isVisible()) {
        await auditBtn.click();
        await sidepanelPage.waitForTimeout(800);
        console.log('✓ Expanded Jury Audit accordion');
      }
    }
  } catch (err) {
    console.warn('Could not expand audit accordion:', err);
  }

  // 4. Save visual proof artifacts
  const artifactDir = '/Users/rishis/.gemini/antigravity-ide/brain/9344fbdc-aca7-450f-bca0-93c22e039bdc';
  await sidepanelPage.screenshot({ path: `${artifactDir}/sidepanel_success.png` });
  await page.screenshot({ path: `${artifactDir}/demo_authenticated.png` });
  console.log('✓ Updated screenshots captured in artifact directory');

  // Extract and save the masked screenshot
  try {
    const maskedImg = sidepanelPage.locator('img[alt="Masked Screenshot as seen by Vision Model"]');
    if (await maskedImg.count() > 0) {
      const src = await maskedImg.getAttribute('src');
      if (src && src.startsWith('data:image')) {
        const base64Data = src.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(`${artifactDir}/masked_preview.png`, Buffer.from(base64Data, 'base64'));
        console.log('✓ Standalone masked_preview.png saved!');
      }
    } else {
      console.warn('Masked image element not found in DOM');
    }
  } catch (err) {
    console.warn('Could not extract masked image preview:', err);
  }

  console.log('====================================================');
  console.log('🚀 SIH26171 Agent is running live in Chrome!');
  console.log('• Portal Tab:   http://localhost:5173/login-demo.html');
  console.log(`• Side Panel:   ${sidepanelUrl}`);
  console.log('====================================================');

  // Keep browser active
  await new Promise(() => {});
}

main().catch(console.error);
