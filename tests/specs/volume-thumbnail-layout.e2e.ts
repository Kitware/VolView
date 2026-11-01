import { volViewPage } from '../pageobjects/volview.page';
import { openConfigAndDataset } from './configTestUtils';

async function waitForPresetThumbnails() {
  const title = $('.v-expansion-panel-title*=Color Presets');
  await title.waitForDisplayed();
  await title.scrollIntoView({ block: 'center', behavior: 'instant' });
  await title.waitForClickable();
  if ((await title.getAttribute('aria-expanded')) !== 'true') {
    await title.click();
  }
  await expect(title).toHaveAttribute('aria-expanded', 'true');

  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const panelTitle = Array.from(
          document.querySelectorAll<HTMLElement>('.v-expansion-panel-title')
        ).find((element) => element.textContent?.includes('Color Presets'));
        const images = Array.from(
          panelTitle
            ?.closest('.v-expansion-panel')
            ?.querySelectorAll<HTMLImageElement>('.thumbnail-container img') ??
            []
        );
        return (
          images.length > 0 &&
          images.every(
            (image) =>
              image.src.startsWith('data:image/png') &&
              image.complete &&
              image.naturalWidth >=
                Math.ceil(
                  image.getBoundingClientRect().width * devicePixelRatio
                ) &&
              image.naturalHeight >=
                Math.ceil(
                  image.getBoundingClientRect().height * devicePixelRatio
                )
          )
        );
      }),
    {
      timeoutMsg:
        'Expected preset thumbnails sharp at the display pixel density',
    }
  );
}

async function selectLayout(name: string, views2D: number, has3D: boolean) {
  await volViewPage.openLayoutMenu(2);
  await volViewPage.selectLayoutOption(name);
  await volViewPage.waitForViewCounts(views2D, has3D);
}

describe('volume preset thumbnails', () => {
  after(async () => {
    await browser.setViewport({
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
    });
  });

  for (const devicePixelRatio of [1, 2]) {
    it(`renders sharp thumbnails at DPR ${devicePixelRatio} after repeatedly removing and restoring the 3D view`, async () => {
      await browser.setViewport({ width: 1280, height: 720, devicePixelRatio });
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
  }
});
