import { test, expect } from '../fixtures';

test.describe('Open files', () => {
  test('imports a selection after garbage collection while the dialog is open', async ({
    page,
    scratch,
    volview,
    utils,
  }) => {
    const image = utils.writeMetaImage('open-files.mha');
    await volview.open();
    const cdp = await page.context().newCDPSession(page);
    await utils.openThroughDialog(scratch.path(image), () =>
      cdp.send('HeapProfiler.collectGarbage')
    );
    await volview.waitForViews();
    await expect(page.locator(`[title="${image}"]`)).toBeVisible();
    expect(await volview.getNotificationsCount()).toEqual(0);
  });
});
