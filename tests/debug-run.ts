import { chromium } from '@playwright/test';
import { getExtensionLaunchArgs, TEST_SITE_URL } from './e2e/harness.js';

async function main() {
  console.log('Launching browser with extension...');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: getExtensionLaunchArgs().filter((arg) => !arg.startsWith('--headless')),
    permissions: [],
  });

  // Wait for background service worker
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 5000 });
  }
  console.log('Service Worker detected:', background.url());
  const extensionId = background.url().split('/')[2];
  console.log('Extension ID:', extensionId);

  // Background console
  background.on('console', (msg) => {
    console.log('[SW Console]', msg.type(), msg.text());
  });
  context.on('serviceworker', (sw) => {
    console.log('[New ServiceWorker]', sw.url());
    sw.on('console', (msg) => console.log('[SW Console]', msg.type(), msg.text()));
  });

  // Open demo site
  const page = await context.newPage();
  page.on('console', (msg) => console.log('[Page Console]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.error('[Page Error]', err));

  console.log('Navigating to', TEST_SITE_URL);
  await page.goto(TEST_SITE_URL);
  await page.waitForTimeout(500);

  // Fill in email and phone so all 5 PII types are active
  await page.fill('#email-input', 'scientist.isro@demo.gov.in');
  await page.fill('#phone-input', '+91 98765 43210');
  await page.waitForTimeout(500);

  // Open sidepanel
  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  console.log('Opening Sidepanel:', sidepanelUrl);
  const sidepanelPage = await context.newPage();
  sidepanelPage.on('console', (msg) => console.log('[Sidepanel Console]', msg.type(), msg.text()));
  sidepanelPage.on('pageerror', (err) => console.error('[Sidepanel Error]', err));
  await sidepanelPage.goto(sidepanelUrl);
  await sidepanelPage.waitForTimeout(1000);

  // Bring demo portal page to front so captureVisibleTab captures the login form
  await page.bringToFront();
  await page.waitForTimeout(300);

  // Check buttons
  console.log('Looking for Run button in sidepanel...');
  const runBtn = sidepanelPage.locator('button:has-text("Run")');
  await runBtn.waitFor({ state: 'visible', timeout: 5000 });
  console.log('Clicking Run button...');
  await runBtn.click();

  // Wait 3 seconds to observe what happens
  await sidepanelPage.waitForTimeout(3000);

  // Inspect DOM elements in demo page
  const domInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .filter((el) => ['img', 'input', 'label', 'canvas', 'h1'].includes(el.tagName.toLowerCase()))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id,
          text: el.textContent?.trim().slice(0, 30),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          scroll: { scrollX: window.scrollX, scrollY: window.scrollY },
          dpr: window.devicePixelRatio,
          viewport: { w: window.innerWidth, h: window.innerHeight }
        };
      });
  });
  console.log('--- Page Elements & BBoxes ---');
  console.log(JSON.stringify(domInfo, null, 2));
  console.log('------------------------------');

  // Capture screenshot of sidepanel and demo page
  const sidepanelText = await sidepanelPage.locator('body').innerText();
  console.log('--- Sidepanel Text Content ---');
  console.log(sidepanelText);
  console.log('-------------------------------');

  const artifactDir = '/Users/rishis/.gemini/antigravity-ide/brain/28535f6b-3fee-4397-bc83-4e2b8747aaad';
  await sidepanelPage.screenshot({ path: `${artifactDir}/sidepanel_success.png` });
  await page.screenshot({ path: `${artifactDir}/demo_authenticated.png` });

  // Extract masked screenshot data URL from sidepanel
  try {
    const maskedImgLocator = sidepanelPage.locator('img[alt="Masked Screenshot as seen by Vision Model"]');
    if (await maskedImgLocator.count() > 0) {
      const src = await maskedImgLocator.getAttribute('src');
      if (src && src.startsWith('data:image')) {
        const base64Data = src.replace(/^data:image\/\w+;base64,/, '');
        const fs = await import('fs');
        fs.writeFileSync(`${artifactDir}/masked_preview.png`, Buffer.from(base64Data, 'base64'));
        console.log('Saved standalone masked_preview.png successfully!');
      }
    } else {
      console.log('Masked image locator not found in sidepanel');
    }
  } catch (err) {
    console.warn('Could not extract masked image:', err);
  }

  const banner = page.locator('#status-banner');
  const bannerVisible = await banner.isVisible();
  const bannerText = await banner.innerText();
  console.log('Status Banner Visible:', bannerVisible);
  console.log('Status Banner Text:', bannerText);

  await context.close();
}

main().catch(console.error);
