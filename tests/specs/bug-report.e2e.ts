import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';

describe('Bug report generation', () => {
  it('should show Copy Bug Report button on error', async () => {
    // Trigger an error by loading a malformed URL
    const manifest = { resources: [{ url: 'bad-url-to-trigger-error' }] };
    await writeManifestToFile(manifest, 'bugReportTest.json');
    await volViewPage.open('?urls=[tmp/bugReportTest.json]');

    await volViewPage.waitForNotification();

    // Click the notifications badge to open the message center
    const notificationBadge = volViewPage.notifications;
    await notificationBadge.click();

    // Wait for the Copy Bug Report button to appear
    await browser.waitUntil(
      async () => {
        const btn = await $('[data-testid="copy-bug-report-button"]');
        return btn.isDisplayed();
      },
      { timeout: 5000, timeoutMsg: 'Expected Copy Bug Report button' }
    );
  });
});
