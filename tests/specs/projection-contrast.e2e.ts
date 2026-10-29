import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import { projectionGrayscaleDistribution } from './slabSamplingTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { JHU_RETINAL_LAYERS, MRA_HEAD_NECK_DATASET } from '../datasets';
import { stageProjectionContrastVolume } from './projectionTestUtils';
import { volViewPage } from '../pageobjects/volview.page';
import {
  chooseEnFaceProjection,
  enFacePixel,
  expandEnFaceSection,
  getEnFaceWindow,
  setEnFaceWindow,
  setSlabRange,
  waitForEnFaceReady,
} from './octTestUtils';
import {
  makeTempDir,
  SESSION_SAVE_TIMEOUT,
  useCachedSample,
  waitForDownload,
  writeManifestToFile,
} from './utils';

const STEM = 'projection-contrast';

function stageSumContrastControl(
  directory: string,
  name: string,
  spacing: number[]
) {
  const values = Array.from({ length: 20 * 3 * 4 }, (_, index) =>
    index % 20 < 10 ? 100 : 200
  );
  fs.writeFileSync(
    path.join(directory, name + '.vti'),
    '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">' +
      `<ImageData WholeExtent="0 19 0 2 0 3" Origin="0 0 0" Spacing="${spacing.join(' ')}">` +
      '<Piece Extent="0 19 0 2 0 3"><PointData Scalars="intensity">' +
      '<DataArray type="Float32" Name="intensity" format="ascii">' +
      values.join(' ') +
      '</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>'
  );
}

async function expectSumPlateaus(low: number, high: number) {
  for (const row of [1, 2]) {
    for (const [column, gray] of [
      [4, low],
      [15, high],
    ]) {
      await browser.waitUntil(async () => {
        const pixel = await enFacePixel(column, row);
        return (
          pixel[3] === 255 &&
          pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1)
        );
      });
    }
  }
}

async function expectVisibleContrast(minimumSpread: number) {
  await browser.waitUntil(async () => {
    const { count, low, high } = await projectionGrayscaleDistribution();
    return count > 1000 && high >= 160 && high - low >= minimumSpread;
  });
}

async function setProjectionSlab(first: number, last: number) {
  await $('[data-testid="oct-en-face-controls"]').click();
  await expandEnFaceSection('projection');
  await setSlabRange(first, last);
  await browser.keys('Escape');
  await waitForEnFaceReady();
}

async function expectAutomaticRange(minimum: number, maximum: number) {
  const window = await getEnFaceWindow();
  expect(window.width).toBeGreaterThan(0);
  expect(window.width).toBeLessThanOrEqual(maximum - minimum + 2);
  expect(window.level).toBeGreaterThanOrEqual(minimum);
  expect(window.level).toBeLessThanOrEqual(maximum);
  return window;
}

async function expectAnalyticalPixel(
  value: number,
  window: { width: number; level: number }
) {
  const gray = Math.round(
    ((value - window.level + window.width / 2) / window.width) * 255
  );
  await browser.waitUntil(async () => {
    const pixel = await enFacePixel(4, 3);
    return pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1);
  });
}

async function enFaceImageBounds() {
  return browser.execute(() => {
    const viewport = document.querySelector(
      '[data-testid="oct-en-face-viewer"]'
    );
    if (!viewport) throw new Error('The En face image viewport is missing');
    const { left, top, width, height } = viewport.getBoundingClientRect();
    return { left, top, width, height };
  });
}

async function doubleClickImage(point: { x: number; y: number }) {
  // Native click counts keep the gesture independent of rendering delays.
  for (const clickCount of [1, 2]) {
    await browser.sendCommandAndGetResult('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      buttons: 1,
      clickCount,
    });
    await browser.sendCommandAndGetResult('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount,
    });
  }
}

describe('Projection default contrast', () => {
  before(async () => {
    await volViewPage.open();
    await setReferenceLinesEnabled(true);
  });
  after(async () => setReferenceLinesEnabled(false));

  before(async () => {
    await useCachedSample(MRA_HEAD_NECK_DATASET);
    await useCachedSample(JHU_RETINAL_LAYERS);
    await writeManifestToFile(
      { layouts: { Projection: [['enface']] } },
      `${STEM}.json`
    );
    const directory = makeTempDir(STEM);
    stageProjectionContrastVolume(directory);
    stageSumContrastControl(directory, 'decimal-sum', [0.01, 0.01, 0.06]);
    stageSumContrastControl(directory, 'exact-sum', [0.125, 0.125, 0.75]);
    const retinal = await JSZip.loadAsync(
      fs.readFileSync(path.join(TEMP_DIR, JHU_RETINAL_LAYERS.name))
    );
    fs.writeFileSync(
      path.join(directory, 'retinal-source.nrrd'),
      await retinal.file('jhu-hc01.nrrd')!.async('nodebuffer')
    );
    await writeManifestToFile(
      {
        layouts: {
          Four: [
            ['axial', 'sagittal'],
            ['coronal', 'enface'],
          ],
        },
      },
      `${STEM}-four.json`
    );
  });

  it('opens the MRA sample Mean projection with visible grayscale contrast', async () => {
    await volViewPage.open(`?urls=[tmp/${STEM}.json]`);
    await volViewPage.samplesList.$('div[title="MRA Head and Neck"]').click();
    await waitForEnFaceReady();
    await expectVisibleContrast(80);
  });

  it('opens the non-DICOM retinal Mean projection with visible grayscale contrast', async () => {
    await volViewPage.open(`?urls=[tmp/${STEM}.json]`);
    await volViewPage.samplesList.$('div[title="Retinal OCT layers"]').click();
    await waitForEnFaceReady();
    await expectVisibleContrast(35);
  });

  for (const manual of [false, true]) {
    it(`preserves ${manual ? 'manual' : 'automatic'} retinal contrast while maximizing and restoring`, async () => {
      await browser.setWindowSize(1400, 1450);
      await browser.setViewport({
        width: 1260,
        height: 1290,
        devicePixelRatio: 1,
      });
      await volViewPage.open(
        `?urls=[tmp/${STEM}-four.json,tmp/${STEM}/retinal-source.nrrd]`
      );
      await volViewPage.waitForViews();
      await waitForEnFaceReady();
      await expectVisibleContrast(35);
      if (manual) await setEnFaceWindow(0.1, 0.16);
      const initialWindow = await getEnFaceWindow();
      const initialSize = await enFaceImageBounds();
      const distribution = await projectionGrayscaleDistribution();
      const initialSpread = distribution.high - distribution.low;

      for (const viewCount of [1, 4]) {
        const canvas = $('[data-testid="oct-en-face-canvas"]');
        await canvas.waitForStable();
        const bounds = await enFaceImageBounds();
        const point = {
          x: Math.round(bounds.left + bounds.width * 0.5),
          y: Math.round(bounds.top + bounds.height * 0.5),
        };
        await browser.waitUntil(
          () =>
            browser.execute(
              ({ x, y }) =>
                !!document
                  .elementFromPoint(x, y)
                  ?.closest('[data-testid="oct-en-face-viewer"]'),
              point
            ),
          { timeoutMsg: 'The visible En face image must receive pointer input' }
        );
        const viewport = $('[data-testid="oct-en-face-viewer"]');
        await viewport.waitForClickable();
        await doubleClickImage(point);
        await browser.waitUntil(
          async () => {
            const size = await enFaceImageBounds();
            return viewCount === 1
              ? size.width > initialSize.width * 1.5 &&
                  size.height > initialSize.height * 1.5
              : Math.abs(size.width - initialSize.width) <= 2 &&
                  Math.abs(size.height - initialSize.height) <= 2;
          },
          {
            timeoutMsg:
              'Double-click must maximize and restore the En face image',
          }
        );
        await waitForEnFaceReady();
        const renderedSize = await enFaceImageBounds();
        if (viewCount === 1) {
          expect(renderedSize.width).toBeGreaterThan(initialSize.width * 1.5);
          expect(renderedSize.height).toBeGreaterThan(initialSize.height * 1.5);
        } else {
          expect(
            Math.abs(renderedSize.width - initialSize.width)
          ).toBeLessThanOrEqual(2);
          expect(
            Math.abs(renderedSize.height - initialSize.height)
          ).toBeLessThanOrEqual(2);
        }
        const actualWindow = await getEnFaceWindow();
        expect(actualWindow).toEqual(initialWindow);
        await browser.waitUntil(
          async () => {
            const { count, low, high } =
              await projectionGrayscaleDistribution();
            return count > 1000 && high - low >= initialSpread - 8;
          },
          {
            timeoutMsg:
              'Maximizing and restoring must retain the retinal grayscale spread',
          }
        );
      }
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }

  it('keeps decimal Sum automatic contrast aligned with an exact-spacing control', async () => {
    for (const name of ['decimal-sum', 'exact-sum']) {
      await volViewPage.open(
        `?urls=[tmp/${STEM}.json,tmp/${STEM}/${name}.vti]`
      );
      await waitForEnFaceReady();
      await chooseEnFaceProjection('oct-projection-method', 'Sum');
      await waitForEnFaceReady();
      // Five samples of each constant-depth ray produce sums 500 and 1000.
      expect(await getEnFaceWindow()).toEqual({ width: 500, level: 750 });
      await expectSumPlateaus(0, 255);
      await setEnFaceWindow(1500, 750);
      await expectSumPlateaus(85, 170);
    }
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('follows projection and slab changes in Auto and preserves saved manual contrast', async () => {
    await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
    await waitForEnFaceReady();
    await expectAnalyticalPixel(
      1551 / 9,
      await expectAutomaticRange(1110 / 9, 1875 / 9)
    );
    await chooseEnFaceProjection('oct-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await expectAnalyticalPixel(549, await expectAutomaticRange(500, 585));
    await chooseEnFaceProjection('oct-projection-method', 'Sum');
    await waitForEnFaceReady();
    await expectAnalyticalPixel(1551, await expectAutomaticRange(1110, 1875));
    await chooseEnFaceProjection('oct-projection-method', 'Mean');
    await setProjectionSlab(1, 3);
    await expectAnalyticalPixel(89, await expectAutomaticRange(40, 125));

    const manual = { width: 160, level: 80 };
    await setEnFaceWindow(manual.width, manual.level);
    await chooseEnFaceProjection('oct-projection-method', 'Maximum');
    await waitForEnFaceReady();
    const automatic = { width: 85, level: 102.5 };
    expect(await getEnFaceWindow()).toEqual(automatic);
    await expectAnalyticalPixel(109, automatic);
    await setEnFaceWindow(manual.width, manual.level);
    await setProjectionSlab(2, 4);
    expect(await getEnFaceWindow()).toEqual(manual);
    await expectAnalyticalPixel(129, manual);
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open(`?urls=[tmp/${saved}]`);
    await waitForEnFaceReady();
    expect(await getEnFaceWindow()).toEqual(manual);
    await expectAnalyticalPixel(129, manual);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
