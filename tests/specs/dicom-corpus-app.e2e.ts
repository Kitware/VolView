import { resolve } from 'node:path';
import volumeCorpus from '../dicomVolumeCorpus.json';
import { DATASET_CACHE } from '../downloadDatasets';
import { volViewPage } from '../pageobjects/volview.page';
import { waitForRenderedSlice } from './dicomRenderedSlice';
import { captureViewPixels, dropFiles } from './utils';

// Undecoded slices render black; chroma can only come from the image.
const colorFraction = async (fileName: string) => {
  const [view] = await captureViewPixels(
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

describe('Corpus files in the application', () => {
  // WebGL often caps 3D textures at 2048 per side, below many radiographs.
  it('renders a mammogram larger than 2048 pixels', async () => {
    const name = corpusFile('idc-mg-cmmd');
    await volViewPage.open(`?urls=[tmp/${name}]`);
    await volViewPage.waitForVolumeCardSliceCounts([1]);
    await volViewPage.waitForViewsLoaded();
    await waitForRenderedSlice(`${name}.png`);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders an HTJ2K image', async () => {
    const name = corpusFile('pydicom-data-HTJ2KLossless_08_RGB');
    await volViewPage.open(`?urls=[tmp/${name}]`);
    await volViewPage.waitForVolumeCardSliceCounts([1]);
    await volViewPage.waitForViewsLoaded();
    await $('header').moveTo();
    await browser.waitUntil(
      async () => (await colorFraction(`${name}.png`)) > 0.5,
      { timeoutMsg: 'Expected the decoded colour image in the slice view' }
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('loads the images of a drop that also holds a structured report', async () => {
    const report = corpusFile('pydicom-test-SR');
    const image = corpusFile('pydicom-CT_small');
    await volViewPage.open();
    await $('#app-container').waitForExist();
    await dropFiles(
      [report, image].map((name) => resolve(DATASET_CACHE, name))
    );
    await volViewPage.waitForVolumeCardSliceCounts([1]);
    await volViewPage.waitForViewsLoaded();
    expect(await volViewPage.getNotificationTitles()).toEqual([
      `DICOM file ${report} holds no image (modality SR). It will be skipped.`,
    ]);
  });
});
