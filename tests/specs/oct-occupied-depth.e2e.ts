import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
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
  THRESHOLD,
  THRESHOLD_SLIDER,
  attachAndSelectMask,
  setThicknessThreshold,
  setHighlight,
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
import { setSegmentationDisplaySlider as setDisplaySlider } from './segmentationTestUtils';
import {
  STEM,
  stageFixture,
  expectProjectionPixel,
  openHighlightedSegmentationDisplay,
  openRetina,
  registerOctTestHooks,
} from './octInteractionTestUtils';

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
                highlightThin: true,
                thresholdMicrons: 3000,
                segmentId: 'band',
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
  it('highlights physical thickness and restores its selected segment, threshold and slab', async () => {
    await openRetina(true);
    await setHighlight(true);
    await setThicknessThreshold(31);
    await expectHighlight(true);
    const expectThinColumns = async () => {
      await browser.waitUntil(
        async () => {
          const thin = await enFacePixel(20, 12);
          const thick = await enFacePixel(60, 12);
          const absent = await enFacePixel(100, 12);
          return (
            thin[0] > thin[1] + 20 &&
            thick[0] === thick[1] &&
            absent[0] === absent[1]
          );
        },
        {
          timeoutMsg:
            'Only positive thickness below the threshold should be highlighted',
        }
      );
    };
    await expectThinColumns();
    const slider = $(THRESHOLD_SLIDER);
    await $(THRESHOLD).click();
    await browser.keys('Tab');
    await expect(slider).toBeFocused();
    await browser.keys('ArrowRight');
    await expect($(THRESHOLD)).toHaveValue('31.1');
    await browser.keys('Home');
    await expect($(THRESHOLD)).toHaveValue('0');
    await expectHighlight(false);
    const maximum = await slider.getAttribute('aria-valuemax');
    await browser.keys('End');
    await expect($(THRESHOLD)).toHaveValue(maximum!);
    await expectHighlight(true);
    await setThicknessThreshold(20.8);
    await expectHighlight(false);
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await expectThinColumns();
    await expandEnFaceSection('projection');
    await setSlabRange(0, 10);
    await expectHighlight(false);
    await expect(slider).toHaveAttribute('aria-valuemax', '0.1');
    await expect($(THRESHOLD)).toHaveValue('31');
    await setSlabRange(100, 114);
    await expectHighlight(true);
    await expectThinColumns();
    await selectSetting(
      'enface-segmentation-segment',
      'Alternative synthetic band'
    );
    await expectHighlight(false);
    await setThicknessThreshold(60);
    await expectHighlight(true);
    await selectSetting('enface-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await expectHighlight(true);
    await openEnFaceControls();
    await expandEnFaceSection('projection');
    await expect(
      $('.v-overlay--active [data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '100');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '114');
    await expandEnFaceSection('thickness');
    await expect($(THRESHOLD)).toHaveValue('60');
    await expect(
      $('.v-overlay--active [data-testid="enface-segmentation-segment"]')
    ).toHaveText(expect.stringContaining('Alternative synthetic band'));
    await expect(
      $('.v-overlay--active [data-testid="enface-thin-highlight"] input')
    ).toBeSelected();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('keeps highlighted pixels aligned with selected slabs', async () => {
    const scene = await stageDepthScene();
    await volViewPage.open(`?urls=[tmp/${scene}]`);
    await waitForEnFaceReady();
    await setEnFaceWindow(200, 100);
    await openEnFaceControls();
    await expandEnFaceSection('thickness');
    await expect(
      $('.v-overlay--active [data-testid="enface-thin-highlight"] input')
    ).toBeEnabled();
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
    await attachAndSelectMask(
      stageFixture('synthetic-thickness.nrrd'),
      'Synthetic retinal band'
    );
    await openEnFaceControls();
    await expandEnFaceSection('thickness');
    await expect(
      $('.v-overlay--active [data-testid="enface-thin-highlight"] input')
    ).toBeEnabled();
    await setHighlight(true);
    await setThicknessThreshold(1);
    await expectHighlight(false);
    await setThicknessThreshold(31);
    await expectHighlight(true);
    const sidebar = $(await openEnFaceSidebarControls());
    for (const selector of [
      '[data-testid="enface-thin-highlight"] input',
      '[data-testid="enface-segmentation-segment"] input',
      '[data-testid="enface-thickness-threshold-input"] input',
    ])
      await expect(sidebar.$(selector)).toBeEnabled();
    await expect(
      sidebar.$('[data-testid="enface-thickness-threshold-input"] input')
    ).toHaveValue('31');
    await expectHighlight(true);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders below-threshold labels with normal fill, outline and visibility controls', async () => {
    await openRetina(true);
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(81);
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
    await openHighlightedSegmentationDisplay();

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

    await $('[data-testid="toggle-segments-visible-button"]').click();
    await expectHighlight(false);
    await setDisplaySlider('Fill Opacity', 1);
    await expectHighlight(false);
    await $('[data-testid="toggle-segments-visible-button"]').click();
    await expectPixel(interior, [255, 0, 0, 255]);
    await expectPixel(boundary, [255, 0, 0, 255]);
  });
});
