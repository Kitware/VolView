import { volViewPage } from '../pageobjects/volview.page';
import { openConfigAndDataset } from './configTestUtils';

async function waitForPresetThumbnails() {
  await browser.waitUntil(
    () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll('.v-expansion-panel-title')).some(
          (element) => element.textContent?.includes('Color Presets')
        )
      ),
    { timeoutMsg: 'Expected the color presets panel' }
  );

  const imageCount = await browser.execute(
    () => document.querySelectorAll('.thumbnail-container img').length
  );
  if (imageCount === 0) {
    await browser.execute(() => {
      const title = Array.from(
        document.querySelectorAll<HTMLElement>('.v-expansion-panel-title')
      ).find((element) => element.textContent?.includes('Color Presets'));
      title?.click();
    });
  }

  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const images = Array.from(
          document.querySelectorAll<HTMLImageElement>(
            '.thumbnail-container img'
          )
        );
        return (
          images.length > 0 &&
          images.every((image) => image.src.startsWith('data:image/png'))
        );
      }),
    { timeoutMsg: 'Expected every color preset thumbnail to finish rendering' }
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
