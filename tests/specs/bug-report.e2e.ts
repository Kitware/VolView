import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';

describe('Bug report generation', () => {
  it('should show Copy Bug Report button on error with stack trace details', async () => {
    // Trigger an error by loading a malformed URL
    const manifest = { resources: [{ url: 'bad-url-to-trigger-error' }] };
    await writeManifestToFile(manifest, 'bugReportTest.json');
    await volViewPage.open('?urls=[tmp/bugReportTest.json]');

    await volViewPage.waitForNotification();

    // Click the notifications badge to open the message center
    const notificationBadge = volViewPage.notifications;
    await notificationBadge.click();

    // Wait for the message center dialog and the Copy Bug Report button in the title
    await browser.waitUntil(
      async () => {
        const btn = await $('[data-testid="copy-bug-report-button"]');
        return btn.isDisplayed();
      },
      { timeout: 5000, timeoutMsg: 'Expected Copy Bug Report button' }
    );

    // Expand the error message to reveal details
    const panelTitle = await $('.v-expansion-panel-title');
    await panelTitle.click();

    // Verify the error details with stack trace are shown
    await browser.waitUntil(
      async () => {
        const details = await $('.details');
        if (!(await details.isExisting())) return false;
        const text = await details.getText();
        return text.length > 0;
      },
      { timeout: 3000, timeoutMsg: 'Expected error details with stack trace' }
    );
  });
});
