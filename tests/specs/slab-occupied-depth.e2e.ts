import fs from 'node:fs';
import path from 'node:path';
import { test, expect, useReferenceLines } from '../fixtures';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import {
  createNrrdVolume,
  gappedSyntheticMask,
  syntheticMask,
} from '../fixtures/oct/volumes';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Utils } from './utils';
import { MENU_PANEL, type OctUtils } from './octTestUtils';

const STEM = 'slab-occupied-depth';
const GAPPED = 'Gapped band';
const BAND = 'Synthetic retinal band';
const ALTERNATIVE = 'Alternative synthetic band';
const DIRECTIONAL = 'Directional band';

type Helpers = { volview: VolViewPage; utils: Utils; oct: OctUtils };

/** Whether the red band tints the pixel, as a thin region or a plain footprint. */
async function expectHighlighted(
  oct: OctUtils,
  present: boolean,
  point = [60, 12]
) {
  await oct.waitForEnFaceReady();
  await expect
    .poll(
      async () => {
        const pixel = await oct.enFacePixel(point[0], point[1]);
        return present ? pixel[0] > pixel[1] + 20 : pixel[0] === pixel[1];
      },
      {
        message: `Expected the selected slab to ${present ? 'draw' : 'not draw'} the band`,
      }
    )
    .toBe(true);
}

async function openGappedMask(
  { volview, utils, oct }: Helpers,
  twoViews = false
) {
  const directory = utils.makeTempDir(STEM);
  fs.writeFileSync(path.join(directory, 'retina.dcm'), createSyntheticOCT());
  fs.writeFileSync(
    path.join(directory, 'gapped-band.nrrd'),
    twoViews ? syntheticMask() : gappedSyntheticMask()
  );
  await utils.writeManifestToFile(
    {
      layouts: {
        'Occupied depth': twoViews
          ? [['axial'], ['enface', 'enface']]
          : [['axial'], ['enface']],
      },
    },
    STEM + '.json'
  );
  await volview.open(
    '?urls=[tmp/' + STEM + '.json,tmp/' + STEM + '/retina.dcm]'
  );
  await oct.waitForEnFaceReady();
  const segment = twoViews ? BAND : GAPPED;
  await oct.attachAndSelectMask(STEM + '/gapped-band.nrrd', segment);
  await oct.openEnFaceControls();
  await oct.setSegmentShown(segment, true);
}

async function openAxisMask({ volview, utils, oct }: Helpers, axis: number) {
  const dimensions = [32, 30, 28];
  const spacing = [0.03, 0.02, 0.01];
  const origin = [19, -25, 7];
  const count = dimensions.reduce((size, n) => size * n, 1);
  const labels = new Uint16Array(count);
  for (let z = 2; z < dimensions[2] - 2; z++)
    for (let y = 2; y < dimensions[1] - 2; y++)
      for (let x = 2; x < dimensions[0] - 2; x++)
        if ([3, 4, 7, 8].includes([x, y, z][axis]))
          labels[x + dimensions[0] * (y + dimensions[1] * z)] = 1;
  const directory = utils.makeTempDir(STEM);
  const sourceFile = `axis-${axis}.nrrd`;
  const maskFile = `axis-${axis}-mask.nrrd`;
  fs.writeFileSync(
    path.join(directory, sourceFile),
    createNrrdVolume({
      scalars: new Uint16Array(count).fill(100),
      dimensions,
      spacing,
      origin,
      units: [],
    })
  );
  fs.writeFileSync(
    path.join(directory, maskFile),
    createNrrdVolume({
      scalars: labels,
      dimensions,
      spacing,
      origin,
      units: [],
      metadata: {
        Segment0_LabelValue: '1',
        Segment0_Name: DIRECTIONAL,
        Segment0_Color: '1 0 0',
      },
    })
  );
  await utils.writeManifestToFile(
    { layouts: { 'Directional occupied depth': [['enface']] } },
    STEM + '.json'
  );
  await volview.open(
    '?urls=[tmp/' + STEM + '.json,tmp/' + STEM + '/' + sourceFile + ']'
  );
  await oct.waitForEnFaceReady();
  await oct.attachAndSelectMask(STEM + '/' + maskFile, DIRECTIONAL);
  await oct.chooseEnFaceProjection(
    'enface-projection-axis',
    ['Sagittal', 'Coronal', 'Axial'][axis]
  );
  await oct.openEnFaceControls();
  await oct.setSegmentShown(DIRECTIONAL, true);
  return spacing[axis] * 1000;
}

test.describe('Selected-slab occupied depth', () => {
  useReferenceLines();

  test('excludes gaps, clips cropped masks to the slab, and keeps strict threshold endpoints', async ({
    volview,
    utils,
    oct,
  }) => {
    await openGappedMask({ volview, utils, oct });
    for (const [first, last, occupied, maximum] of [
      [100, 105, 41.6, 41.7],
      [101, 104, 20.8, 20.9],
      [101, 101, 10.4, 10.5],
      [0, 110, 41.6, 41.7],
    ]) {
      await oct.expandEnFaceSection('projection');
      await oct.setSlabRange(first, last);
      await oct.waitForEnFaceReady();
      await expect(oct.segmentThresholdSlider(GAPPED)).toHaveAttribute(
        'aria-valuemax',
        String(maximum)
      );
      await oct.setSegmentThreshold(GAPPED, occupied);
      await expectHighlighted(oct, false);
      await oct.setSegmentThreshold(GAPPED, occupied + 0.1);
      await expectHighlighted(oct, true);
      const absent = await oct.enFacePixel(0, 12);
      expect(absent[0]).toBe(absent[1]);
    }
    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(102, 103);
    await oct.waitForEnFaceReady();
    await expect(oct.segmentThresholdSlider(GAPPED)).toHaveAttribute(
      'aria-valuemax',
      '0.1'
    );
    await expect(oct.segmentThreshold(GAPPED)).toHaveValue('41.7');
    await expectHighlighted(oct, false);
    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(100, 105);
    await oct.setSegmentThreshold(GAPPED, 41.6);
    await expectHighlighted(oct, false);
    await oct.setSegmentThreshold(GAPPED, null);
    await expect(oct.segmentThreshold(GAPPED)).toHaveValue('');
    await expect(oct.segmentThresholdSlider(GAPPED)).toHaveAttribute(
      'aria-valuenow',
      '41.7'
    );
    await expectHighlighted(oct, true);
    await oct.setSegmentThreshold(GAPPED, 41.6);
    await expectHighlighted(oct, false);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('remeasures mask storage grown by painting in an ordinary source slice', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    await openGappedMask({ volview, utils, oct });
    await oct.setSegmentThreshold(GAPPED, 50);
    await expect(oct.segmentThresholdSlider(GAPPED)).toHaveAttribute(
      'aria-valuemax',
      '41.7'
    );
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU_PANEL)).toBeHidden();
    const source = page.locator('[data-testid~="vtk-two-view"]').first();
    await source.click();
    const slice = await volview.getFirst2DSlice();
    if (slice === undefined)
      throw new Error('Source slice position is unavailable.');
    const pixel = () => oct.enFacePixel(64, slice - 1);
    await expect
      .poll(
        async () => {
          const [r, g] = await pixel();
          return r > g + 20;
        },
        { message: 'Expected the original four-cell band to qualify.' }
      )
      .toBe(true);
    await volview.activatePaint();
    const brush = page.locator('[role="slider"][aria-label="Brush size"]');
    await expect(brush).toBeVisible();
    const maximumBrushSize = await brush.getAttribute('aria-valuemax');
    if (maximumBrushSize === null)
      throw new Error('Brush size maximum is unavailable.');
    await brush.focus();
    await page.keyboard.press('End');
    await expect(brush).toHaveAttribute('aria-valuenow', maximumBrushSize);
    await volview.paintStrokeOnView(source);
    await page.mouse.move(10, 10);
    await oct.waitForEnFaceReady();
    await expect
      .poll(
        async () => {
          const [r, g] = await pixel();
          return r === g;
        },
        {
          message: 'Expected the thicker painted column to stop qualifying.',
        }
      )
      .toBe(true);
    await oct.openEnFaceControls();
    await oct.expandEnFaceSection('segments');
    await expect
      .poll(
        async () =>
          Number(
            await oct
              .segmentThresholdSlider(GAPPED)
              .getAttribute('aria-valuemax')
          ),
        {
          message:
            'Expected the fitted thickness maximum to reflect source mask growth.',
        }
      )
      .toBeGreaterThan(41.7);
    await expect(oct.segmentThreshold(GAPPED)).toHaveValue('50');
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('restores different thin segments, slabs, thresholds and enabled states in two panes', async ({
    page,
    volview,
    utils,
    oct,
    segmentation,
  }) => {
    await openGappedMask({ volview, utils, oct }, true);
    const panes = page.locator('[data-testid="enface-viewer"]');
    await oct.setSegmentThreshold(BAND, 31);
    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(100, 103);
    await page.keyboard.press('Escape');
    await oct.openEnFaceControls(panes.nth(1));
    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(110, 114);
    await oct.setSegmentShown(ALTERNATIVE, true);
    await page.keyboard.press('Escape');
    await segmentation.openSegmentDisplay();
    await segmentation.setSegmentationDisplaySlider('Fill Opacity', 0.5);
    await segmentation.setSegmentationDisplaySlider('Outline Thickness', 5);
    const firstPixel = () => oct.enFacePixel(20, 12, undefined, panes.nth(0));
    await expect
      .poll(
        async () => {
          const [r, g] = await firstPixel();
          return r > g + 20;
        },
        { message: 'Expected the first pane to show its thin band.' }
      )
      .toBe(true);
    const secondPixel = () => oct.enFacePixel(60, 12, undefined, panes.nth(1));
    await expect
      .poll(
        async () => {
          const [r, g] = await secondPixel();
          return g > r + 20;
        },
        {
          message:
            'Expected the second pane to draw its whole band with Thin off.',
        }
      )
      .toBe(true);
    const expected = [await firstPixel(), await secondPixel()];
    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    const restored = page.locator('[data-testid="enface-viewer"]');
    await expect(restored).toHaveCount(2);
    for (const index of [0, 1]) {
      const pane = restored.nth(index);
      await oct.waitForEnFaceReady(pane);
      await expect
        .poll(
          async () =>
            (await oct.enFacePixel(index ? 60 : 20, 12, undefined, pane)).every(
              (value, channel) =>
                Math.abs(value - expected[index][channel]) <= 1
            ),
          {
            message:
              'Expected the saved pane to restore its segmentation appearance.',
          }
        )
        .toBe(true);
      await oct.openEnFaceControls(pane);
      await oct.expandEnFaceSection('projection');
      await expect(oct.slabThumb('start')).toHaveAttribute(
        'aria-valuenow',
        index ? '110' : '100'
      );
      await expect(oct.slabThumb('end')).toHaveAttribute(
        'aria-valuenow',
        index ? '114' : '103'
      );
      await oct.expandEnFaceSection('segments');
      for (const [name, pressed] of [
        [BAND, !index],
        [ALTERNATIVE, !!index],
      ] as const)
        await expect(oct.segmentEye(name)).toHaveAttribute(
          'aria-pressed',
          String(pressed)
        );
      if (index)
        await expect(oct.segmentThreshold(ALTERNATIVE)).toHaveValue('');
      else await expect(oct.segmentThreshold(BAND)).toHaveValue('31');
      await page.keyboard.press('Escape');
    }
    await segmentation.openSegmentDisplay();
    for (const [label, value] of [
      ['Fill Opacity', '0.5'],
      ['Outline Thickness', '5'],
    ]) {
      await expect(
        page.locator(
          '[data-testid="segment-list"] [role="slider"][aria-label="' +
            label +
            '"]'
        )
      ).toHaveAttribute('aria-valuenow', value);
    }
    await oct.openEnFaceControls(restored.nth(1));
    // Below the 52 um band, so the threshold hides it.
    await oct.setSegmentThreshold(ALTERNATIVE, 40);
    await expect
      .poll(
        async () => {
          const [r, g] = await oct.enFacePixel(
            60,
            12,
            undefined,
            restored.nth(1)
          );
          return g === r;
        },
        {
          message:
            'Expected the second pane to use its own restored segment and threshold.',
        }
      )
      .toBe(true);
    expect(await oct.enFacePixel(20, 12, undefined, restored.nth(0))).toEqual(
      expected[0]
    );
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  for (const axis of [0, 1, 2]) {
    test(`uses imported geometry without unit declarations on axis ${axis} at a translated source origin`, async ({
      volview,
      utils,
      oct,
    }) => {
      const cellLength = await openAxisMask({ volview, utils, oct }, axis);
      for (const [first, last, count] of [
        [3, 8, 4],
        [4, 7, 2],
      ]) {
        await oct.expandEnFaceSection('projection');
        await oct.setSlabRange(first, last);
        await oct.waitForEnFaceReady();
        const occupied = count * cellLength;
        await expect(oct.segmentThresholdSlider(DIRECTIONAL)).toHaveAttribute(
          'aria-valuemax',
          String(occupied + 0.1)
        );
        await oct.setSegmentThreshold(DIRECTIONAL, occupied);
        await expectHighlighted(oct, false, [15, 14]);
        await oct.setSegmentThreshold(DIRECTIONAL, occupied + 0.1);
        await expectHighlighted(oct, true, [15, 14]);
      }
      await oct.expandEnFaceSection('projection');
      await oct.setSlabRange(5, 6);
      await oct.waitForEnFaceReady();
      await expect(oct.segmentThresholdSlider(DIRECTIONAL)).toHaveAttribute(
        'aria-valuemax',
        '0.1'
      );
      await expectHighlighted(oct, false, [15, 14]);
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }
});
