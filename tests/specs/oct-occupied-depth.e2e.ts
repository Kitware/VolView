import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect, registerOctTestHooks } from '../fixtures';
import { createNrrdVolume, createVtiVolume } from '../fixtures/oct/volumes';
import { stageGenericOCT } from './octTestUtils';
import type { SegmentationUtils } from './segmentationTestUtils';
import type { Utils } from './utils';
import { STEM, type OctInteractionUtils } from './octInteractionTestUtils';

const BAND = 'Synthetic retinal band';
const ALTERNATIVE = 'Alternative synthetic band';

/** Leaves the popup closed so each test opens the controls it needs. */
async function openRetinaWithBand(
  page: Page,
  octInteraction: OctInteractionUtils,
  segmentation: SegmentationUtils
) {
  await octInteraction.openRetina(true);
  await page.keyboard.press('Escape');
  await segmentation.setSegmentVisible(ALTERNATIVE, false);
}

async function stageDepthScene(utils: Utils) {
  const directory = utils.makeTempDir(STEM);
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

test.describe('Retinal OCT occupied-depth', () => {
  registerOctTestHooks();
  test('highlights physical thickness per segment and restores each threshold and the slab', async ({
    page,
    volview,
    oct,
    octInteraction,
    segmentation,
  }) => {
    await openRetinaWithBand(page, octInteraction, segmentation);
    await oct.openEnFaceControls();
    await oct.setSegmentThreshold(BAND, 31);
    await oct.expectHighlight(true);
    // Either tint leaves blue as the untinted reference channel.
    const tinted = (channel: number) => (pixel: number[]) =>
      pixel[channel] > pixel[2] + 20;
    const untinted = (channel: number) => (pixel: number[]) =>
      pixel[channel] === pixel[2];
    const expectColumns = async (alternativeDrawn: boolean) => {
      await oct.waitForEnFaceReady();
      const alternative = (alternativeDrawn ? tinted : untinted)(1);
      await expect
        .poll(
          async () => {
            const thin = await oct.enFacePixel(20, 12);
            const thick = await oct.enFacePixel(60, 12);
            const absent = await oct.enFacePixel(100, 12);
            return (
              tinted(0)(thin) &&
              untinted(0)(thick) &&
              untinted(0)(absent) &&
              [thin, thick, absent].every(alternative)
            );
          },
          {
            message:
              'Only positive thickness below each threshold should be highlighted' +
              (alternativeDrawn ? ', over the alternative band' : ''),
          }
        )
        .toBe(true);
    };
    const expectThinColumns = () => expectColumns(false);
    await expectThinColumns();
    const threshold = oct.segmentThreshold(BAND);
    const slider = oct.segmentThresholdSlider(BAND);
    await threshold.click();
    await page.keyboard.press('Shift+Tab');
    await expect(slider).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(threshold).toHaveValue('31.1');
    await page.keyboard.press('Home');
    await expect(threshold).toHaveValue('0');
    await oct.expectHighlight(false);
    await page.keyboard.press('End');
    await expect(threshold).toHaveValue('');
    await oct.expectHighlight(true);
    await oct.setSegmentThreshold(BAND, 20.8);
    await oct.expectHighlight(false);
    await oct.setSegmentThreshold(BAND, 31);
    await oct.expectHighlight(true);
    await expectThinColumns();
    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(0, 10);
    await oct.expectHighlight(false);
    await expect(slider).toHaveAttribute('aria-valuemax', '0.1');
    await expect(threshold).toHaveValue('31');
    await oct.setSlabRange(100, 114);
    await oct.expectHighlight(true);
    await expectThinColumns();

    await expect(oct.segmentEye(ALTERNATIVE)).toBeDisabled();
    await page.keyboard.press('Escape');
    await segmentation.setSegmentVisible(ALTERNATIVE, true);
    await oct.openEnFaceControls();
    await oct.setSegmentShown(ALTERNATIVE, true);
    await expectColumns(true);
    await oct.setSegmentThreshold(ALTERNATIVE, 50);
    await expectThinColumns();
    await oct.setSegmentThreshold(ALTERNATIVE, 60);
    const expectBothThin = () => expectColumns(true);
    await expectBothThin();
    await oct.expandEnFaceSection('projection');
    await oct.selectSetting('enface-projection-method', 'Maximum');
    await oct.waitForEnFaceReady();
    await page.keyboard.press('Escape');
    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    await oct.waitForEnFaceReady();
    await expectBothThin();
    await oct.openEnFaceControls();
    await oct.expandEnFaceSection('projection');
    await expect(
      page.locator(
        '.v-overlay--active [data-testid="enface-projection-method"] input'
      )
    ).toHaveValue('Maximum');
    await expect(oct.slabThumb('start')).toHaveAttribute(
      'aria-valuenow',
      '100'
    );
    await expect(oct.slabThumb('end')).toHaveAttribute('aria-valuenow', '114');
    await oct.expandEnFaceSection('segments');
    for (const [name, value] of [
      [BAND, '31'],
      [ALTERNATIVE, '60'],
    ]) {
      await expect(oct.segmentEye(name)).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(oct.segmentThreshold(name)).toHaveValue(value);
    }
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps highlighted pixels aligned with selected slabs', async ({
    volview,
    utils,
    oct,
  }) => {
    const scene = await stageDepthScene(utils);
    await volview.open(`?urls=[tmp/${scene}]`);
    await oct.waitForEnFaceReady();
    await oct.setEnFaceWindow(200, 100);
    await oct.openEnFaceControls();
    await oct.expandEnFaceSection('segments');
    const eye = oct.segmentEye('Depth band');
    await expect(eye).toBeEnabled();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(oct.segmentThreshold('Depth band')).toHaveValue('3000');
    const slabs = [
      [0, 7, [true, false, false]],
      [0, 1, [false, false, false]],
      [2, 2, [true, true, false]],
      [4, 5, [false, true, false]],
    ] satisfies [number, number, boolean[]][];
    for (const [first, last, highlighted] of slabs) {
      await oct.expandEnFaceSection('projection');
      await oct.setSlabRange(first, last);
      await expect
        .poll(
          async () => {
            const pixels = await Promise.all(
              [1.5, 3.5, 6].map((x) => oct.enFacePixel(x, 2.5))
            );
            return pixels.every((pixel, index) =>
              highlighted[index]
                ? pixel[0] > pixel[1] + 20 && pixel[0] > pixel[2] + 20
                : pixel[0] === pixel[1] &&
                  pixel[1] === pixel[2] &&
                  pixel[0] > 20
            );
          },
          {
            message: `Expected occupied-depth pixels for slab ${first}-${last}`,
          }
        )
        .toBe(true);
    }
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('uses imported NIfTI geometry for thickness when units are unspecified', async ({
    page,
    volview,
    utils,
    oct,
    octInteraction,
    segmentation,
  }) => {
    const directory = utils.makeTempDir(STEM);
    const name = stageGenericOCT(directory, 'nii', false);
    await volview.open();
    await utils.openThroughDialog(path.join(directory, name));
    await volview.waitForViews();
    await oct.selectEnFace();
    await oct.openEnFaceControls();
    await oct.expandEnFaceSection('projection');
    await oct.selectSetting('enface-projection-axis', 'Coronal');
    await oct.waitForEnFaceReady();
    await page.keyboard.press('Escape');
    await oct.attachAndSelectMask(
      octInteraction.stageFixture('synthetic-thickness.nrrd'),
      BAND
    );
    await segmentation.setSegmentVisible(ALTERNATIVE, false);
    await oct.openEnFaceControls();
    await oct.expandEnFaceSection('segments');
    await expect(oct.segmentEye(BAND)).toBeEnabled();
    await oct.setSegmentThreshold(BAND, 1);
    await oct.expectHighlight(false);
    await oct.setSegmentThreshold(BAND, 31);
    await oct.expectHighlight(true);
    const sidebar = await oct.openEnFaceSidebarControls();
    await oct.expandEnFaceSection('segments', sidebar);
    await expect(oct.segmentEye(BAND, sidebar)).toBeEnabled();
    await expect(oct.segmentEye(BAND, sidebar)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(oct.segmentThreshold(BAND, sidebar)).toBeEnabled();
    await expect(oct.segmentThreshold(BAND, sidebar)).toHaveValue('31');
    await oct.expectHighlight(true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('renders below-threshold labels with normal fill, outline and visibility controls', async ({
    page,
    oct,
    octInteraction,
    segmentation,
  }) => {
    await octInteraction.openRetina(true);
    // Keeps the alternative band, which no control here hides, out of the slab.
    await oct.setSlabRange(100, 105);
    await page.keyboard.press('Escape');
    const toggleEverySegment = () =>
      page.locator('[data-testid="toggle-segments-visible-button"]').click();
    await toggleEverySegment();
    await oct.expectHighlight(false);
    const unwindowed = JSON.stringify(await oct.enFacePixel(60, 12));
    await oct.setEnFaceWindow(1000, 500);
    // Baselines must come from a frame drawn with the new window.
    await expect
      .poll(async () => JSON.stringify(await oct.enFacePixel(60, 12)))
      .not.toBe(unwindowed);
    const interior = () => oct.enFacePixel(20, 12);
    const boundary = () => oct.enFacePixel(42.5, 12, { x: -2, y: 0 });
    const innerBoundary = () => oct.enFacePixel(42.5, 12, { x: -12, y: 0 });
    const scanEdge = () => oct.enFacePixel(-0.5, 12, { x: 2, y: 0 });
    const outside = () => oct.enFacePixel(60, 12);
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
      expect
        .poll(
          async () =>
            (await sample()).every(
              (channel, index) => Math.abs(channel - expected[index]) <= 2
            ),
          { message: `Expected rendered label pixel ${expected.join(',')}` }
        )
        .toBe(true);
    const red = (background: number[], alpha: number) =>
      background.map((channel, index) =>
        index === 3
          ? 255
          : Math.round(channel * (1 - alpha) + (index === 0 ? 255 : 0) * alpha)
      );
    const setDisplaySlider = segmentation.setSegmentationDisplaySlider;
    await toggleEverySegment();
    await octInteraction.openHighlightedSegmentationDisplay(BAND);

    await setDisplaySlider('Outline Thickness', 10);
    await setDisplaySlider('Fill Opacity', 0);
    await expectPixel(boundary, [255, 0, 0, 255]);
    await expectPixel(interior, baseline.interior);
    await expectPixel(innerBoundary, baseline.innerBoundary);
    await expectPixel(outside, baseline.outside);
    // Standard label outlines stay inside the label and do not invent scan-edge background.
    await expectPixel(scanEdge, baseline.scanEdge);
    expect((await oct.enFaceAppearance()).coloredPixels).toBeGreaterThan(100);

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
    await oct.expectHighlight(false);
    await setDisplaySlider('Outline Opacity', 1);
    await setDisplaySlider('Outline Thickness', 10);
    await expectPixel(boundary, [255, 0, 0, 255]);
    await expectPixel(interior, baseline.interior);

    await toggleEverySegment();
    await oct.expectHighlight(false);
    await setDisplaySlider('Fill Opacity', 1);
    await oct.expectHighlight(false);
    await toggleEverySegment();
    await expectPixel(interior, [255, 0, 0, 255]);
    await expectPixel(boundary, [255, 0, 0, 255]);
  });
});
