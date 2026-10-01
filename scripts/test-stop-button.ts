import { chromium } from '@playwright/test';
import { getExtensionLaunchArgs, TEST_SITE_URL } from '../tests/e2e/harness.js';

async function testStop() {
  console.log('Testing Stop button explicitly...');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: getExtensionLaunchArgs().filter((arg) => !arg.startsWith('--headless')),
    permissions: [],
  });

  try {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 5000 });
    }
    const extensionId = background.url().split('/')[2];

    const page = await context.newPage();
    await page.goto(TEST_SITE_URL);
    await page.waitForTimeout(500);

    const sidepanelPage = await context.newPage();
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidepanelPage.waitForTimeout(800);

    // Click Run
    const runBtn = sidepanelPage.locator('button:has-text("Run")');
    await runBtn.click();
    console.log('Clicked Run...');

    // Wait until Stop button appears
    const stopBtn = sidepanelPage.locator('button:has-text("Stop")');
    await stopBtn.waitFor({ state: 'visible', timeout: 3000 });
    console.log('✓ Stop button is visible! Clicking Stop...');

    await stopBtn.click();
    console.log('Clicked Stop button!');

    // Wait 500ms and verify Run button is restored
    await sidepanelPage.waitForTimeout(600);
    const runRestored = await runBtn.isVisible();
    const stateBadge = await sidepanelPage.locator('div:has-text("State Machine") > span').last().textContent();

    console.log('Run button restored:', runRestored);
    console.log('State Badge after Stop:', stateBadge?.trim());

    if (runRestored && stateBadge?.trim() === 'IDLE') {
      console.log('✅ PASS: Stop button immediately halted task and restored IDLE UI state!');
    } else {
      console.error('❌ Stop button failed to restore IDLE state');
    }
  } finally {
    await context.close();
  }
}

testStop().catch(console.error);
