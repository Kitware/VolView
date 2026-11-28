import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText, type VolViewPage } from '../pageobjects/volview.page';

async function waitForPresetThumbnails(page: Page) {
  const title = page.locator('.v-expansion-panel-title', {
    hasText: containsText('Color Presets'),
  });
  await expect(title).toBeVisible();
  await title.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await expect(title).toBeEnabled();
  if ((await title.getAttribute('aria-expanded')) !== 'true') {
    await title.click();
  }
  await expect(title).toHaveAttribute('aria-expanded', 'true');

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const panelTitle = Array.from(
            document.querySelectorAll<HTMLElement>('.v-expansion-panel-title')
          ).find((element) => element.textContent?.includes('Color Presets'));
          const images = Array.from(
            panelTitle
              ?.closest('.v-expansion-panel')
              ?.querySelectorAll<HTMLImageElement>(
                '.thumbnail-container img'
              ) ?? []
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
        message:
          'Expected preset thumbnails sharp at the display pixel density',
      }
    )
    .toBe(true);
}

async function selectLayout(
  volview: VolViewPage,
  name: string,
  views2D: number,
  has3D: boolean
) {
  await volview.openLayoutMenu(2);
  await volview.selectLayoutOption(name);
  await volview.waitForViewCounts(views2D, has3D);
}

test.describe('volume preset thumbnails', () => {
  for (const devicePixelRatio of [1, 2]) {
    // An untitled group carries the pixel ratio without changing the title.
    test.describe(() => {
      test.use({ deviceScaleFactor: devicePixelRatio });

      test(`renders sharp thumbnails at DPR ${devicePixelRatio} after repeatedly removing and restoring the 3D view`, async ({
        page,
        volview,
        configUtils,
      }) => {
        await configUtils.openConfigAndDataset(
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

        await volview.waitForViewCounts(3, true);
        await volview.renderingModuleTab.click();
        await waitForPresetThumbnails(page);

        for (let cycle = 0; cycle < 3; cycle += 1) {
          await selectLayout(volview, 'Single Axial', 1, false);
          await selectLayout(volview, 'Four Up', 3, true);
          await waitForPresetThumbnails(page);
        }
      });
    });
  }
});
