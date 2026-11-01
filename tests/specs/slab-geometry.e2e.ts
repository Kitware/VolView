import fs from 'node:fs';
import path from 'node:path';
import { useReferenceLines } from './referenceLinesTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { createNrrdVolume, createVtiVolume } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import {
  canvasAppearance,
  enFaceAppearance,
  enFacePixel,
  setEnFaceWindow,
  waitForEnFaceReady,
  CANVAS,
} from './octTestUtils';
import {
  makeTempDir,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  writeManifestToFile,
} from './utils';

const SOURCE = '[data-testid~="vtk-two-view"] canvas';
const STEM = 'slab-geometry';
function signedFitVolume(negativeAxis?: 0 | 2) {
  const spacing = [negativeAxis === 0 ? -4 : 4, 1, negativeAxis === 2 ? -1 : 1];
  const direction = [
    negativeAxis === 0 ? 1 : -1,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    negativeAxis === 2 ? 1 : -1,
  ];
  const values = Array.from({ length: 20 * 10 * 10 }, (_, index) => {
    const x = index % 20;
    if (x < 2 || x >= 18) return 255;
    return x === 2 || x === 17 ? 0 : 70;
  });
  return createVtiVolume({
    dimensions: [20, 10, 10],
    spacing,
    direction,
    type: 'UInt8',
    values,
  });
}

async function expectEdgeFiducials(selector: string) {
  const canvas = await $(selector).getElement();
  await browser.waitUntil(
    async () => {
      const samples = await canvas.execute((element) => {
        const image = element as HTMLCanvasElement;
        const copy = document.createElement('canvas');
        copy.width = image.width;
        copy.height = image.height;
        const context = copy.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return [0.05, 0.5, 0.95].map((fraction) =>
          Array.from(
            context.getImageData(
              Math.floor(image.width * fraction),
              Math.floor(image.height / 2),
              1,
              1
            ).data
          )
        );
      });
      return samples.every(
        (pixel, index) =>
          pixel[3] === 255 &&
          pixel
            .slice(0, 3)
            .every((channel) =>
              index === 1 ? channel > 20 && channel < 150 : channel > 240
            )
      );
    },
    {
      timeoutMsg:
        'Expected both white image-edge fiducials and the gray center to fit',
    }
  );
}

async function openScene(name: string) {
  await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/${name}]`);
  await waitForEnFaceReady();
}

async function expectPixels(expected: string) {
  await browser.waitUntil(
    async () => (await enFaceAppearance()).image === expected,
    { timeoutMsg: 'Expected the same fitted slab pixels' }
  );
}

async function fittedPixels() {
  await browser.waitUntil(async () => {
    const pixels = await Promise.all([enFacePixel(4, 4), enFacePixel(27, 4)]);
    return pixels.every((pixel) => pixel.every((channel) => channel === 255));
  });
  return (await enFaceAppearance()).image;
}

describe('Slab geometry and automatic camera fitting', () => {
  useReferenceLines();

  before(async () => {
    const directory = makeTempDir(STEM);
    fs.writeFileSync(path.join(directory, 'reflected.vti'), signedFitVolume());
    fs.writeFileSync(path.join(directory, 'signed-x.vti'), signedFitVolume(0));
    fs.writeFileSync(path.join(directory, 'signed-z.vti'), signedFitVolume(2));
    fs.writeFileSync(
      path.join(directory, 'wide.nrrd'),
      createNrrdVolume({
        dimensions: [32, 4, 8],
        spacing: [1, 1, 1],
        scalars: Uint16Array.from({ length: 32 * 4 * 8 }, (_, i) =>
          i % 32 < 8 || i % 32 >= 24 ? 200 : 100
        ),
      })
    );
    await writeManifestToFile(
      { layouts: { 'Slab geometry': [['coronal'], ['enface']] } },
      STEM + '.json'
    );
  });

  it('fits signed-spacing equivalents with both edge fiducials after load and reset', async () => {
    let expectedProjection = '';
    let expectedSource = '';
    for (const name of ['reflected.vti', 'signed-x.vti', 'signed-z.vti']) {
      await openScene(name);
      await setEnFaceWindow(255, 127.5);
      for (const reset of [false, true]) {
        if (reset)
          await $('button[data-testid="control-button-Reset Views"]').click();
        await expectEdgeFiducials(CANVAS);
        await expectEdgeFiducials(SOURCE);
        if (expectedProjection) {
          await expectPixels(expectedProjection);
          await browser.waitUntil(
            async () =>
              (await canvasAppearance(await $(SOURCE).getElement())).image ===
              expectedSource,
            { timeoutMsg: 'Expected the same fitted source slice pixels' }
          );
        } else {
          expectedProjection = (await enFaceAppearance()).image;
          expectedSource = (
            await canvasAppearance(await $(SOURCE).getElement())
          ).image;
        }
      }
    }
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('keeps automatic fitting through remount, scene restore and later resize', async () => {
    await openScene('wide.nrrd');
    await $('[data-testid="enface-reset-camera"]').click();
    await browser.setViewport({ width: 500, height: 720, devicePixelRatio: 1 });
    await $(CANVAS).waitForStable();
    const fitted = await fittedPixels();
    await browser.setViewport({
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
    });
    await $(SOURCE).waitForStable();
    await $(SOURCE).doubleClick();
    await expect($(CANVAS)).not.toExist();
    await $(SOURCE).waitForStable();
    await $(SOURCE).doubleClick();
    await waitForEnFaceReady();
    await browser.setViewport({ width: 500, height: 720, devicePixelRatio: 1 });
    await expectPixels(fitted);

    await browser.setViewport({
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
    });
    await $(CANVAS).waitForStable();
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await browser.setViewport({ width: 500, height: 720, devicePixelRatio: 1 });
    await expectPixels(fitted);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
