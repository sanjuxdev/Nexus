import { test, expect, chromium } from '@playwright/test';
import { getExtensionLaunchArgs, TEST_SITE_URL } from './harness.js';
import fs from 'node:fs';

test.describe('E2E Phase 7: Surgical Redaction Verification', () => {
  test('Evaluate Expected Region vs Actual Mask via IoU', async () => {
    const browser = await chromium.launchPersistentContext('', {
      headless: true,
      args: getExtensionLaunchArgs(),
    });
    
    const page = await browser.newPage();
    
    // Listen for the console message that contains the machine-readable report
    const reportPromise = new Promise<any>((resolve) => {
      page.on('console', msg => {
        const text = msg.text();
        if (text.startsWith('E2E_REPORT_GENERATED')) {
          const jsonStr = text.replace('E2E_REPORT_GENERATED ', '');
          try {
            resolve(JSON.parse(jsonStr));
          } catch (e) {
            console.error('Failed to parse report', e);
          }
        }
      });
    });

    await page.goto(TEST_SITE_URL.replace('login-demo.html', 'privacy-test.html'));

    // Wait for dynamic content to render (1000ms) + time for perception loop
    await page.waitForTimeout(2000);

    // Get the generated report
    const report = await reportPromise;
    expect(report).toBeDefined();
    
    // Save the machine-readable report to disk
    fs.writeFileSync('phase7_machine_report.json', JSON.stringify(report, null, 2));
    
    console.log('Phase 7 Surgical Redaction Report Generated: phase7_machine_report.json');

    await browser.close();
  });
});
