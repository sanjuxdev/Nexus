import { chromium } from '@playwright/test';
import { getExtensionLaunchArgs, TEST_SITE_URL } from '../tests/e2e/harness.js';
import * as fs from 'fs';

async function test() {
  console.log('Testing perception progress and Stop button...');
  const profileDir = '/tmp/sih-test-profile';
  try {
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  } catch {}

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      ...getExtensionLaunchArgs().filter(a => !a.startsWith('--headless')),
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 8000 });
    }
    const extensionId = background.url().split('/')[2];
    console.log('✓ Extension loaded ID:', extensionId);

    // 1. Open Portal
    const page = await context.newPage();
    await page.goto(TEST_SITE_URL);
    await page.waitForTimeout(600);
    await page.fill('#email-input', 'scientist.isro@demo.gov.in');
    await page.fill('#phone-input', '+91 98765 43210');
    console.log('✓ Demo portal loaded and filled');

    // 2. Open Sidepanel
    const sidepanelPage = await context.newPage();
    await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidepanelPage.waitForTimeout(800);

    sidepanelPage.on('console', msg => console.log('[Sidepanel]', msg.text()));
    page.on('console', msg => console.log('[Portal]', msg.text()));

    // 3. Test Run -> Progression past PERCEIVING
    console.log('✓ Clicking Run in side panel...');
    const runBtn = sidepanelPage.locator('button:has-text("Run")');
    await runBtn.click();

    // Check that it doesn't get stuck in PERCEIVING (wait up to 5s)
    let finalState = '';
    for (let i = 0; i < 25; i++) {
      await sidepanelPage.waitForTimeout(200);
      const stateBadge = sidepanelPage.locator('div:has-text("State Machine") > span').last();
      const badgeText = (await stateBadge.textContent())?.trim() || '';
      console.log(`[T+${i * 200}ms] State Badge: "${badgeText}"`);
      if (badgeText && badgeText !== 'PERCEIVING' && badgeText !== 'IDLE') {
        finalState = badgeText;
        console.log(`✓ Progression confirmed! Current state is: ${badgeText}`);
        break;
      }
    }

    if (!finalState) {
      console.error('❌ Failed to progress past PERCEIVING.');
    } else {
      console.log('✅ PASS: State progressed to', finalState);
    }

    // Wait 2 seconds for full execution flow
    await sidepanelPage.waitForTimeout(2500);

    const artifactDir = '/Users/rishis/.gemini/antigravity-ide/brain/28535f6b-3fee-4397-bc83-4e2b8747aaad';
    await sidepanelPage.screenshot({ path: `${artifactDir}/sidepanel_success.png` });
    await page.screenshot({ path: `${artifactDir}/demo_authenticated.png` });
    console.log('✓ Updated screenshots captured in artifact directory');

    // Extract masked preview
    try {
      const maskedImg = sidepanelPage.locator('img[alt="Masked Screenshot as seen by Vision Model"]');
      if (await maskedImg.count() > 0) {
        const src = await maskedImg.getAttribute('src');
        if (src && src.startsWith('data:image')) {
          const base64Data = src.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(`${artifactDir}/masked_preview.png`, Buffer.from(base64Data, 'base64'));
          console.log('✓ Saved masked_preview.png');
        }
      }
    } catch (e) {
      console.warn('Could not extract masked preview:', e);
    }

    // 4. Test Stop Button
    console.log('Testing Stop button functionality...');
    // Trigger another task
    const input = sidepanelPage.locator('input[placeholder="Enter browser task..."]');
    await input.fill('Test stop command');
    const startBtn = sidepanelPage.locator('button:has-text("Run")');
    if (await startBtn.isVisible()) {
      await startBtn.click();
    }
    await sidepanelPage.waitForTimeout(300);

    const stopBtn = sidepanelPage.locator('button:has-text("Stop")');
    if (await stopBtn.isVisible()) {
      console.log('✓ Stop button is visible. Clicking Stop...');
      await stopBtn.click();
      await sidepanelPage.waitForTimeout(600);
      const isRunVisibleAgain = await sidepanelPage.locator('button:has-text("Run")').isVisible();
      if (isRunVisibleAgain) {
        console.log('✅ PASS: Stop button successfully cancelled task and returned UI to Run state!');
      } else {
        console.warn('⚠️ Run button did not immediately reappear after Stop.');
      }
    } else {
      console.log('Task already completed or stopped.');
    }

  } finally {
    await context.close();
  }
}

test().catch(console.error);
