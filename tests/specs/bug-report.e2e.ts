import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';

describe('Bug report generation', () => {
  it('should attach bug report to error messages', async () => {
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

    // Verify bug report content via the store
    const report = await browser.execute(() => {
      // Access the Pinia store from the app instance
      const app = document.querySelector('#app') as any;
      const pinia = app?.__vue_app__?.config?.globalProperties?.$pinia;
      if (!pinia) return '';
      const store = pinia.state.value.message;
      if (!store) return '';
      const firstId = store.msgList[0];
      return store.byID[firstId]?.bugReport ?? '';
    });

    expect(report).toContain('--- VolView Bug Report ---');
    expect(report).toContain('Browser:');
  });
});
