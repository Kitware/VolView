import { volViewPage } from '../pageobjects/volview.page';
import { openConfigAndDataset } from './configTestUtils';
import { openVolumeRenderingControls } from './volumeRenderingTestUtils';

async function waitForPresetThumbnails() {
  await openVolumeRenderingControls();
  const card = $('[data-testid="volume-preset-Adaptive-Balanced"]');
  await card.scrollIntoView({ block: 'center', behavior: 'instant' });

  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const images = Array.from(
          document.querySelectorAll<HTMLImageElement>(
            '[data-testid^="volume-preset-"] img'
          )
        );
        return (
          images.length > 0 &&
          images.every(
            (image) =>
              image.src.startsWith('data:image/png') &&
              image.complete &&
              image.naturalWidth === 80 &&
              image.naturalHeight === 80
          )
        );
      }),
    { timeoutMsg: 'Expected decoded 80px preset thumbnails' }
  );
}

async function selectLayout(name: string, views2D: number, has3D: boolean) {
  await volViewPage.openLayoutMenu(2);
  await volViewPage.selectLayoutOption(name);
  await volViewPage.waitForViewCounts(views2D, has3D);
}

describe('volume preset thumbnails', () => {
  it('renders thumbnails after repeatedly removing and restoring the 3D view', async () => {
    await openConfigAndDataset(
      {
        layouts: {
          'Four Up': [
            ['axial', 'sagittal'],
            ['coronal', 'volume'],
          ],
          'Single Axial': [['axial']],
        },
      },
      'volume-thumbnail-layout'
    );

    await volViewPage.waitForViewCounts(3, true);
    await volViewPage.renderingModuleTab.waitForClickable();
    await volViewPage.renderingModuleTab.click();
    await waitForPresetThumbnails();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await selectLayout('Single Axial', 1, false);
      await selectLayout('Four Up', 3, true);
      await waitForPresetThumbnails();
    }
  });
});
