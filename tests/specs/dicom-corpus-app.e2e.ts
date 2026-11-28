import { resolve } from 'node:path';
import volumeCorpus from '../dicomVolumeCorpus.json' with { type: 'json' };
import { DATASET_CACHE } from '../downloadDatasets';
import { test, expect } from '../fixtures';
import { createRenderedSlice } from './dicomRenderedSlice';
import type { Utils } from './utils';

// Undecoded slices render black; chroma can only come from the image.
const colorFraction = async (utils: Utils, fileName: string) => {
  const [view] = await utils.captureViewPixels(
    '[data-testid~="vtk-two-view"]',
    80,
    fileName
  );
  const { data } = view;
  let colored = 0;
  for (let index = 0; index < data.length; index += 4) {
    const channels = [data[index], data[index + 1], data[index + 2]];
    if (Math.max(...channels) - Math.min(...channels) > 32) colored++;
  }
  return colored / (data.length / 4);
};

const corpusFile = (id: string) => {
  const entry = volumeCorpus.datasets.find((dataset) => dataset.id === id);
  if (!entry) throw new Error(`No corpus entry ${id}`);
  return entry.name;
};

test.describe('Corpus files in the application', () => {
  // WebGL often caps 3D textures at 2048 per side, below many radiographs.
  test('renders a mammogram larger than 2048 pixels', async ({
    page,
    volview,
    utils,
  }) => {
    const { waitForRenderedSlice } = createRenderedSlice(page, utils);
    const name = corpusFile('idc-mg-cmmd');
    await volview.open(`?urls=[tmp/${name}]`);
    await volview.waitForVolumeCardSliceCounts([1]);
    await volview.waitForViewsLoaded();
    await waitForRenderedSlice(`${name}.png`);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('renders an HTJ2K image', async ({ page, volview, utils }) => {
    const name = corpusFile('pydicom-data-HTJ2KLossless_08_RGB');
    await volview.open(`?urls=[tmp/${name}]`);
    await volview.waitForVolumeCardSliceCounts([1]);
    await volview.waitForViewsLoaded();
    await page.locator('header').hover();
    await expect
      .poll(() => colorFraction(utils, `${name}.png`), {
        message: 'Expected the decoded color image in the slice view',
      })
      .toBeGreaterThan(0.5);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('displays MONOCHROME1 images with inverted grayscale', async ({
    page,
    volview,
    utils,
  }) => {
    const palette = page.locator('[data-testid="base-image-colormap"]');
    const openShowingPalette = async (id: string) => {
      await volview.open(`?urls=[tmp/${corpusFile(id)}]`);
      await volview.waitForVolumeCardSliceCounts([1]);
      await volview.waitForViewsLoaded();
      await volview.renderingModuleTab.click();
      await utils.waitForModuleTransitions();
      await expect(palette).toBeVisible();
    };
    await openShowingPalette('gdcm-CR-MONO1-10-chest');
    await expect(palette).toContainText('Inverted grayscale');
    // An ACR-NEMA era file: no preamble or file meta.
    expect(await volview.getNotificationTitles()).toEqual([
      'A DICOM file has no file meta information',
    ]);
    await openShowingPalette('pydicom-CT_small');
    await expect(palette).not.toContainText('Inverted grayscale');
    await expect(palette).toContainText('Grayscale');
  });

  test('loads the images of a drop that also holds a structured report', async ({
    page,
    volview,
    utils,
  }) => {
    const report = corpusFile('pydicom-test-SR');
    const image = corpusFile('pydicom-CT_small');
    await volview.open();
    await expect(page.locator('#app-container')).toBeAttached();
    await utils.dropFiles(
      [report, image].map((name) => resolve(DATASET_CACHE, name))
    );
    await volview.waitForVolumeCardSliceCounts([1]);
    await volview.waitForViewsLoaded();
    expect(await volview.getNotificationTitles()).toEqual([
      `DICOM file ${report} holds no image (modality SR). It will be skipped.`,
    ]);
  });
});
