import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { openThroughDialog, writeMetaImage } from './utils';

describe('Open files', () => {
  it('imports a selection after garbage collection while the dialog is open', async () => {
    const image = writeMetaImage('open-files.mha');
    await volViewPage.open();
    await openThroughDialog(path.join(TEMP_DIR, image), () =>
      browser.sendCommandAndGetResult('HeapProfiler.collectGarbage', {})
    );
    await volViewPage.waitForViews();
    await expect($(`[title="${image}"]`)).toBeDisplayed();
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
