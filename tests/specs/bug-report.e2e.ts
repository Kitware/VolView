import { test, expect } from '../fixtures';

test.describe('Bug report generation', () => {
  test('should show Copy Bug Report button on error', async ({
    page,
    volview,
    utils,
  }) => {
    // Trigger an error by loading a malformed URL
    const manifest = { resources: [{ url: 'bad-url-to-trigger-error' }] };
    await utils.writeManifestToFile(manifest, 'bugReportTest.json');
    await volview.open('?urls=[tmp/bugReportTest.json]');

    await volview.waitForNotification();

    // Click the notifications badge to open the message center
    const notificationBadge = volview.notifications;
    await notificationBadge.click();

    // Wait for the Copy Bug Report button to appear
    await expect(
      page.locator('[data-testid="copy-bug-report-button"]'),
      'Expected Copy Bug Report button'
    ).toBeVisible();
  });
});
