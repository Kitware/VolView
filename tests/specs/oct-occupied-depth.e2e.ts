import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { Key } from 'webdriverio';
import { createNrrdVolume, createVtiVolume } from '../fixtures/oct/volumes';
import {
  enFaceAppearance,
  enFacePixel,
  waitForEnFaceReady,
  stageGenericOCT,
  expandEnFaceSection,
  setSlabRange,
  setEnFaceWindow,
  slabThumb,
  selectEnFace,
  openEnFaceControls,
  openEnFaceSidebarControls,
  selectSetting,
  segmentThreshold,
  segmentThresholdSlider,
  segmentEye,
  attachAndSelectMask,
  setSegmentShown,
  setSegmentThreshold,
  expectHighlight,
} from './octTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  openThroughDialog,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';
import {
  setSegmentationDisplaySlider as setDisplaySlider,
  setSegmentVisible,
} from './segmentationTestUtils';
import {
  STEM,
  stageFixture,
  openHighlightedSegmentationDisplay,
  openRetina,
  registerOctTestHooks,
} from './octInteractionTestUtils';

const BAND = 'Synthetic retinal band';
const ALTERNATIVE = 'Alternative synthetic band';

/** Leaves the popup closed so each test opens the controls it needs. */
async function openRetinaWithBand() {
  await openRetina(true);
  await browser.keys('Escape');
  await setSegmentVisible(ALTERNATIVE, false);
}

async function stageDepthScene() {
  const directory = makeTempDir(STEM);
  const name = 'depth';
  fs.writeFileSync(
    path.join(directory, name + '.vti'),
    createVtiVolume({
      values: new Uint16Array(8 ** 3).fill(100),
      dimensions: [8, 8, 8],
      origin: [1, 1, 1],
      type: 'UInt16',
    })
  );
  const zip = new JSZip();
  zip.file(
    'mask.nrrd',
    createNrrdVolume({
      dimensions: [4, 4, 4],
      spacing: [1, 1, 1],
      origin: [2, 3, 2],
      scalars: Uint16Array.from({ length: 4 ** 3 }, (_, index) =>
        index % 4 < 2 && Math.floor(index / 4) % 4 >= 2 ? 0 : 1
      ),
    })
  );
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${STEM}/${name}.vti` }],
      segments: [{ id: 'band', name: 'Depth band', color: [255, 0, 0, 255] }],
      segmentations: [
        {
          id: 'segmentation',
          name: 'Depth band',
          parentImage: '0',
          fillOpacity: 1,
          outlineOpacity: 0,
          outlineThickness: 0,
          order: ['mask'],
          masks: [
            {
              id: 'mask',
              segmentId: 'band',
              representations: {
                labelmap: {
                  path: 'mask.nrrd',
                  extent: [1, 4, 2, 5, 1, 4],
                },
              },
            },
          ],
        },
      ],
      viewByID: {
        enface: {
          id: 'enface',
          name: 'En face',
          type: 'EnFace',
          dataID: '0',
          config: {
            '0': {
              enFace: {
                axis: 1,
                method: 'mean',
                depthStart: 0,
                depthEnd: null,
                segmentProjections: {
                  band: {
                    visible: true,
                    thresholdMicrons: 3000,
                  },
                },
              },
            },
          },
        },
      },
      layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
      layoutSlots: ['enface'],
      activeView: 'enface',
    })
  );
  fs.writeFileSync(
    path.join(directory, name + '.volview.zip'),
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  return `${STEM}/${name}.volview.zip`;
}

describe('Retinal OCT occupied-depth', () => {
  registerOctTestHooks();
  it('highlights physical thickness per segment and restores each threshold and the slab', async () => {
    await openRetinaWithBand();
    await openEnFaceControls();
    await setSegmentThreshold(BAND, 31);
    await expectHighlight(true);
    // Either tint leaves blue as the untinted reference channel.
    const tinted = (channel: number) => (pixel: number[]) =>
      pixel[channel] > pixel[2] + 20;
    const untinted = (channel: number) => (pixel: number[]) =>
      pixel[channel] === pixel[2];
    const expectColumns = async (alternativeDrawn: boolean) => {
      await waitForEnFaceReady();
      const alternative = (alternativeDrawn ? tinted : untinted)(1);
      await browser.waitUntil(
        async () => {
          const thin = await enFacePixel(20, 12);
          const thick = await enFacePixel(60, 12);
          const absent = await enFacePixel(100, 12);
          return (
            tinted(0)(thin) &&
            untinted(0)(thick) &&
            untinted(0)(absent) &&
            [thin, thick, absent].every(alternative)
          );
        },
        {
          timeoutMsg:
            'Only positive thickness below each threshold should be highlighted' +
            (alternativeDrawn ? ', over the alternative band' : ''),
        }
      );
    };
    const expectThinColumns = () => expectColumns(false);
    await expectThinColumns();
    const threshold = segmentThreshold(BAND);
    const slider = segmentThresholdSlider(BAND);
    await threshold.click();
    await browser
      .action('key')
      .down(Key.Shift)
      .down(Key.Tab)
      .up(Key.Tab)
      .up(Key.Shift)
      .perform();
    await expect(slider).toBeFocused();
    await browser.keys('ArrowRight');
    await expect(threshold).toHaveValue('31.1');
    await browser.keys('Home');
    await expect(threshold).toHaveValue('0');
    await expectHighlight(false);
    await browser.keys('End');
    await expect(threshold).toHaveValue('');
    await expectHighlight(true);
    await setSegmentThreshold(BAND, 20.8);
    await expectHighlight(false);
    await setSegmentThreshold(BAND, 31);
    await expectHighlight(true);
    await expectThinColumns();
    await expandEnFaceSection('projection');
    await setSlabRange(0, 10);
    await expectHighlight(false);
    await expect(slider).toHaveAttribute('aria-valuemax', '0.1');
    await expect(threshold).toHaveValue('31');
    await setSlabRange(100, 114);
    await expectHighlight(true);
    await expectThinColumns();

    await expect(segmentEye(ALTERNATIVE)).toBeDisabled();
    await browser.keys('Escape');
    await setSegmentVisible(ALTERNATIVE, true);
    await openEnFaceControls();
    await setSegmentShown(ALTERNATIVE, true);
    await expectColumns(true);
    await setSegmentThreshold(ALTERNATIVE, 50);
    await expectThinColumns();
    await setSegmentThreshold(ALTERNATIVE, 60);
    const expectBothThin = () => expectColumns(true);
    await expectBothThin();
    await expandEnFaceSection('projection');
    await selectSetting('enface-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await expectBothThin();
    await openEnFaceControls();
    await expandEnFaceSection('projection');
    await expect(
      $('.v-overlay--active [data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '100');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '114');
    await expandEnFaceSection('segments');
    for (const [name, value] of [
      [BAND, '31'],
      [ALTERNATIVE, '60'],
    ]) {
      await expect(segmentEye(name)).toHaveAttribute('aria-pressed', 'true');
      await expect(segmentThreshold(name)).toHaveValue(value);
    }
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('keeps highlighted pixels aligned with selected slabs', async () => {
    const scene = await stageDepthScene();
    await volViewPage.open(`?urls=[tmp/${scene}]`);
    await waitForEnFaceReady();
    await setEnFaceWindow(200, 100);
    await openEnFaceControls();
    await expandEnFaceSection('segments');
    const eye = segmentEye('Depth band');
    await expect(eye).toBeEnabled();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(segmentThreshold('Depth band')).toHaveValue('3000');
    const slabs = [
      [0, 7, [true, false, false]],
      [0, 1, [false, false, false]],
      [2, 2, [true, true, false]],
      [4, 5, [false, true, false]],
    ] satisfies [number, number, boolean[]][];
    for (const [first, last, highlighted] of slabs) {
      await expandEnFaceSection('projection');
      await setSlabRange(first, last);
      await browser.waitUntil(
        async () => {
          const pixels = await Promise.all(
            [1.5, 3.5, 6].map((x) => enFacePixel(x, 2.5))
          );
          return pixels.every((pixel, index) =>
            highlighted[index]
              ? pixel[0] > pixel[1] + 20 && pixel[0] > pixel[2] + 20
              : pixel[0] === pixel[1] && pixel[1] === pixel[2] && pixel[0] > 20
          );
        },
        {
          timeoutMsg: `Expected occupied-depth pixels for slab ${first}-${last}`,
        }
      );
    }
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('uses imported NIfTI geometry for thickness when units are unspecified', async () => {
    const directory = makeTempDir(STEM);
    const name = stageGenericOCT(directory, 'nii', false);
    await volViewPage.open();
    await openThroughDialog(path.join(directory, name));
    await volViewPage.waitForViews();
    await selectEnFace();
    await openEnFaceControls();
    await expandEnFaceSection('projection');
    await selectSetting('enface-projection-axis', 'Coronal');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    await attachAndSelectMask(stageFixture('synthetic-thickness.nrrd'), BAND);
    await setSegmentVisible(ALTERNATIVE, false);
    await openEnFaceControls();
    await expandEnFaceSection('segments');
    await expect(segmentEye(BAND)).toBeEnabled();
    await setSegmentThreshold(BAND, 1);
    await expectHighlight(false);
    await setSegmentThreshold(BAND, 31);
    await expectHighlight(true);
    const sidebar = await openEnFaceSidebarControls();
    await expandEnFaceSection('segments', sidebar);
    await expect(segmentEye(BAND, sidebar)).toBeEnabled();
    await expect(segmentEye(BAND, sidebar)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(segmentThreshold(BAND, sidebar)).toBeEnabled();
    await expect(segmentThreshold(BAND, sidebar)).toHaveValue('31');
    await expectHighlight(true);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders below-threshold labels with normal fill, outline and visibility controls', async () => {
    await openRetina(true);
    // Keeps the alternative band, which no control here hides, out of the slab.
    await setSlabRange(100, 105);
    await browser.keys('Escape');
    const toggleEverySegment = () =>
      $('[data-testid="toggle-segments-visible-button"]').click();
    await toggleEverySegment();
    await expectHighlight(false);
    const unwindowed = JSON.stringify(await enFacePixel(60, 12));
    await setEnFaceWindow(1000, 500);
    // Baselines must come from a frame drawn with the new window.
    await browser.waitUntil(
      async () => JSON.stringify(await enFacePixel(60, 12)) !== unwindowed
    );
    const interior = () => enFacePixel(20, 12);
    const boundary = () => enFacePixel(42.5, 12, { x: -2, y: 0 });
    const innerBoundary = () => enFacePixel(42.5, 12, { x: -12, y: 0 });
    const scanEdge = () => enFacePixel(-0.5, 12, { x: 2, y: 0 });
    const outside = () => enFacePixel(60, 12);
    const baseline = {
      interior: await interior(),
      boundary: await boundary(),
      innerBoundary: await innerBoundary(),
      scanEdge: await scanEdge(),
      outside: await outside(),
    };
    const expectPixel = async (
      sample: () => Promise<number[]>,
      expected: number[]
    ) =>
      browser.waitUntil(
        async () =>
          (await sample()).every(
            (channel, index) => Math.abs(channel - expected[index]) <= 2
          ),
        { timeoutMsg: `Expected rendered label pixel ${expected.join(',')}` }
      );
    const red = (background: number[], alpha: number) =>
      background.map((channel, index) =>
        index === 3
          ? 255
          : Math.round(channel * (1 - alpha) + (index === 0 ? 255 : 0) * alpha)
      );
    await toggleEverySegment();
    await openHighlightedSegmentationDisplay(BAND);

    await setDisplaySlider('Outline Thickness', 10);
    await setDisplaySlider('Fill Opacity', 0);
    await expectPixel(boundary, [255, 0, 0, 255]);
    await expectPixel(interior, baseline.interior);
    await expectPixel(innerBoundary, baseline.innerBoundary);
    await expectPixel(outside, baseline.outside);
    // Standard label outlines stay inside the label and do not invent scan-edge background.
    await expectPixel(scanEdge, baseline.scanEdge);
    expect((await enFaceAppearance()).coloredPixels).toBeGreaterThan(100);

    await setDisplaySlider('Fill Opacity', 0.5);
    await setDisplaySlider('Outline Opacity', 0.5);
    await expectPixel(interior, red(baseline.interior, 0.5));
    await expectPixel(boundary, red(baseline.boundary, 0.5));
    await expectPixel(outside, baseline.outside);

    await setDisplaySlider('Outline Opacity', 0);
    await expectPixel(boundary, baseline.boundary);
    await expectPixel(interior, red(baseline.interior, 0.5));
    await setDisplaySlider('Outline Thickness', 0);
    await expectPixel(boundary, red(baseline.boundary, 0.5));
    await setDisplaySlider('Fill Opacity', 0);
    await expectHighlight(false);
    await setDisplaySlider('Outline Opacity', 1);
    await setDisplaySlider('Outline Thickness', 10);
    await expectPixel(boundary, [255, 0, 0, 255]);
    await expectPixel(interior, baseline.interior);

    await toggleEverySegment();
    await expectHighlight(false);
    await setDisplaySlider('Fill Opacity', 1);
    await expectHighlight(false);
    await toggleEverySegment();
    await expectPixel(interior, [255, 0, 0, 255]);
    await expectPixel(boundary, [255, 0, 0, 255]);
  });
});
