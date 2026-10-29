import fs from 'node:fs';
import path from 'node:path';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import { Key } from 'webdriverio';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import {
  createNrrdVolume,
  gappedSyntheticMask,
  syntheticMask,
} from '../fixtures/oct/volumes';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  writeManifestToFile,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  attachMaskThroughDataPanel,
  chooseEnFaceProjection,
  enFacePixel,
  expandEnFaceSection,
  setSlabRange,
  slabThumb,
  waitForEnFaceReady,
} from './octTestUtils';
import {
  openAnnotationSegments,
  setSegmentationDisplaySlider,
  selectSegment,
  waitForSegmentContent,
} from './segmentationTestUtils';

const STEM = 'slab-occupied-depth';
const PANEL = '.v-overlay--active [data-testid="oct-rendering-panel"]';
const INPUT = PANEL + ' [data-testid="oct-thickness-threshold-input"] input';
const SLIDER =
  PANEL + ' [data-testid="oct-thickness-threshold"] [role="slider"]';

async function expectHighlighted(present: boolean, point = [60, 12]) {
  await browser.waitUntil(
    async () => {
      const pixel = await enFacePixel(point[0], point[1]);
      return present ? pixel[0] > pixel[1] + 20 : pixel[0] === pixel[1];
    },
    {
      timeoutMsg: `Expected the selected slab to ${present ? 'qualify' : 'not qualify'} for highlighting`,
    }
  );
}

async function threshold(value: number) {
  await expandEnFaceSection('thickness');
  await setValueVueInput($(INPUT), String(value));
}

async function openGappedMask(twoViews = false) {
  const directory = makeTempDir(STEM);
  fs.writeFileSync(path.join(directory, 'retina.dcm'), createSyntheticOCT());
  fs.writeFileSync(
    path.join(directory, 'gapped-band.nrrd'),
    twoViews ? syntheticMask() : gappedSyntheticMask()
  );
  await writeManifestToFile(
    {
      layouts: {
        'Occupied depth': twoViews
          ? [['axial'], ['enface', 'enface']]
          : [['axial'], ['enface']],
      },
    },
    STEM + '.json'
  );
  await volViewPage.open(
    '?urls=[tmp/' + STEM + '.json,tmp/' + STEM + '/retina.dcm]'
  );
  await waitForEnFaceReady();
  await attachMaskThroughDataPanel(STEM + '/gapped-band.nrrd');
  await openAnnotationSegments();
  const segment = twoViews ? 'Synthetic retinal band' : 'Gapped band';
  await waitForSegmentContent(segment);
  await selectSegment(segment);
  await $('[data-testid="oct-en-face-controls"]').click();
  await expandEnFaceSection('thickness');
  await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
}

async function openAxisMask(axis: number) {
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
  const directory = makeTempDir(STEM);
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
        Segment0_Name: 'Directional band',
        Segment0_Color: '1 0 0',
      },
    })
  );
  await writeManifestToFile(
    { layouts: { 'Directional occupied depth': [['enface']] } },
    STEM + '.json'
  );
  await volViewPage.open(
    '?urls=[tmp/' + STEM + '.json,tmp/' + STEM + '/' + sourceFile + ']'
  );
  await waitForEnFaceReady();
  await attachMaskThroughDataPanel(STEM + '/' + maskFile);
  await openAnnotationSegments();
  await waitForSegmentContent('Directional band');
  await selectSegment('Directional band');
  await chooseEnFaceProjection(
    'oct-projection-axis',
    ['Sagittal', 'Coronal', 'Axial'][axis]
  );
  await $('[data-testid="oct-en-face-controls"]').click();
  await expandEnFaceSection('thickness');
  await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
  return spacing[axis] * 1000;
}

async function openSharedAppearance() {
  await browser.keys(Key.Escape);
  await openAnnotationSegments();
  const display = $('[data-testid="segment-display-section"]');
  if ((await display.getAttribute('aria-expanded')) !== 'true')
    await display.click();
}

describe('Selected-slab occupied depth', () => {
  before(async () => {
    await volViewPage.open();
    await setReferenceLinesEnabled(true);
  });
  after(async () => setReferenceLinesEnabled(false));

  it('excludes gaps, clips cropped masks to the slab, and keeps strict threshold endpoints', async () => {
    await openGappedMask();
    for (const [first, last, occupied, maximum] of [
      [100, 105, 41.6, 41.7],
      [101, 104, 20.8, 20.9],
      [101, 101, 10.4, 10.5],
      [0, 110, 41.6, 41.7],
    ]) {
      await expandEnFaceSection('projection');
      await setSlabRange(first, last);
      await waitForEnFaceReady();
      await expandEnFaceSection('thickness');
      await expect($(SLIDER)).toHaveAttribute('aria-valuemax', String(maximum));
      await threshold(occupied);
      await expectHighlighted(false);
      await threshold(occupied + 0.1);
      await expectHighlighted(true);
      const absent = await enFacePixel(0, 12);
      expect(absent[0]).toBe(absent[1]);
    }
    await expandEnFaceSection('projection');
    await setSlabRange(102, 103);
    await waitForEnFaceReady();
    await expect($(SLIDER)).toHaveAttribute('aria-valuemax', '0.1');
    await expect($(INPUT)).toHaveValue('41.7');
    await expectHighlighted(false);
    await expandEnFaceSection('thickness');
    await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
    await expandEnFaceSection('projection');
    await setSlabRange(100, 105);
    await waitForEnFaceReady();
    await expectHighlighted(false);
    await expandEnFaceSection('thickness');
    await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
    await expect($(SLIDER)).toHaveAttribute('aria-valuemax', '41.7');
    await expectHighlighted(true);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('remeasures mask storage grown by painting in an ordinary source slice', async () => {
    await openGappedMask();
    await threshold(50);
    await expect($(SLIDER)).toHaveAttribute('aria-valuemax', '41.7');
    await browser.keys(Key.Escape);
    await $(
      '.v-overlay--active [data-testid="oct-rendering-panel"]'
    ).waitForDisplayed({
      reverse: true,
    });
    const source = $('[data-testid~="vtk-two-view"]');
    await source.click();
    const slice = await volViewPage.getFirst2DSlice();
    if (slice === null)
      throw new Error('Source slice position is unavailable.');
    const pixel = () => enFacePixel(64, slice - 1);
    await browser.waitUntil(
      async () => {
        const [r, g] = await pixel();
        return r > g + 20;
      },
      { timeoutMsg: 'Expected the original four-cell band to qualify.' }
    );
    await volViewPage.activatePaint();
    const brush = $('[role="slider"][aria-label="Brush size"]');
    await brush.waitForDisplayed();
    const maximumBrushSize = await brush.getAttribute('aria-valuemax');
    if (maximumBrushSize === null)
      throw new Error('Brush size maximum is unavailable.');
    await brush.execute((element) => element.focus());
    await browser.keys(Key.End);
    await expect(brush).toHaveAttribute('aria-valuenow', maximumBrushSize);
    await volViewPage.paintStrokeOnView(source);
    await browser.action('pointer').move({ x: 10, y: 10 }).perform();
    await browser.waitUntil(
      async () => {
        const [r, g] = await pixel();
        return r === g;
      },
      { timeoutMsg: 'Expected the thicker painted column to stop qualifying.' }
    );
    await $('[data-testid="oct-en-face-controls"]').click();
    await expandEnFaceSection('thickness');
    await browser.waitUntil(
      async () => Number(await $(SLIDER).getAttribute('aria-valuemax')) > 41.7,
      {
        timeoutMsg:
          'Expected the fitted thickness maximum to reflect source mask growth.',
      }
    );
    await expect($(INPUT)).toHaveValue('50');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('restores different selected segments, slabs, thresholds and enabled states in two panes', async () => {
    await openGappedMask(true);
    const panes = await $$('[data-testid="oct-en-face-viewer"]').map((view) =>
      view.getElement()
    );
    await threshold(31);
    await expandEnFaceSection('projection');
    await setSlabRange(100, 103);
    await browser.keys(Key.Escape);
    await panes[1].$('[data-testid="oct-en-face-controls"]').click();
    await expandEnFaceSection('thickness');
    await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
    await chooseEnFaceProjection(
      'oct-segmentation-segment',
      'Alternative synthetic band',
      panes[1]
    );
    await panes[1].$('[data-testid="oct-en-face-controls"]').click();
    await threshold(60);
    await expandEnFaceSection('projection');
    await setSlabRange(110, 114);
    await expandEnFaceSection('thickness');
    await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
    await browser.keys(Key.Escape);
    await openSharedAppearance();
    await setSegmentationDisplaySlider('Fill Opacity', 0.5);
    await setSegmentationDisplaySlider('Outline Thickness', 5);
    const firstPixel = () => enFacePixel(20, 12, undefined, panes[0]);
    await browser.waitUntil(
      async () => {
        const [r, g] = await firstPixel();
        return r > g + 20;
      },
      {
        timeoutMsg:
          'Expected only the first pane to show its selected thin band.',
      }
    );
    const expected = [
      await firstPixel(),
      await enFacePixel(60, 12, undefined, panes[1]),
    ];
    expect(expected[1][0]).toBe(expected[1][1]);
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await browser.waitUntil(
      async () => (await $$('[data-testid="oct-en-face-viewer"]').length) === 2
    );
    const restored = await $$('[data-testid="oct-en-face-viewer"]').map(
      (view) => view.getElement()
    );
    for (const [index, pane] of restored.entries()) {
      await waitForEnFaceReady(pane);
      await browser.waitUntil(
        async () =>
          (await enFacePixel(index ? 60 : 20, 12, undefined, pane)).every(
            (value, channel) => Math.abs(value - expected[index][channel]) <= 1
          ),
        {
          timeoutMsg:
            'Expected the saved pane to restore its segmentation appearance.',
        }
      );
      await pane.$('[data-testid="oct-en-face-controls"]').click();
      await expandEnFaceSection('projection');
      await expect(slabThumb('start')).toHaveAttribute(
        'aria-valuenow',
        index ? '110' : '100'
      );
      await expect(slabThumb('end')).toHaveAttribute(
        'aria-valuenow',
        index ? '114' : '103'
      );
      await expandEnFaceSection('thickness');
      await expect($(INPUT)).toHaveValue(index ? '60' : '31');
      await expect(
        $(PANEL).$('[data-testid="oct-segmentation-segment"]')
      ).toHaveText(
        expect.stringContaining(
          index ? 'Alternative synthetic band' : 'Synthetic retinal band'
        )
      );
      const enabled = $(PANEL).$('[data-testid="oct-thin-highlight"] input');
      if (index) await expect(enabled).not.toBeSelected();
      else await expect(enabled).toBeSelected();
      await browser.keys(Key.Escape);
    }
    await openSharedAppearance();
    for (const [label, value] of [
      ['Fill Opacity', '0.5'],
      ['Outline Thickness', '5'],
    ]) {
      await expect(
        $(
          '[data-testid="segment-list"] [role="slider"][aria-label="' +
            label +
            '"]'
        )
      ).toHaveAttribute('aria-valuenow', value);
    }
    await restored[1].$('[data-testid="oct-en-face-controls"]').click();
    await expandEnFaceSection('thickness');
    await $(PANEL).$('[data-testid="oct-thin-highlight"] label').click();
    await browser.waitUntil(
      async () => {
        const [r, g] = await enFacePixel(60, 12, undefined, restored[1]);
        return g > r + 20;
      },
      {
        timeoutMsg:
          'Expected the second pane to use its own restored segment and threshold.',
      }
    );
    expect(await enFacePixel(20, 12, undefined, restored[0])).toEqual(
      expected[0]
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  for (const axis of [0, 1, 2]) {
    it(`uses imported geometry without unit declarations on axis ${axis} at a translated source origin`, async () => {
      const cellLength = await openAxisMask(axis);
      for (const [first, last, count] of [
        [3, 8, 4],
        [4, 7, 2],
      ]) {
        await expandEnFaceSection('projection');
        await setSlabRange(first, last);
        await waitForEnFaceReady();
        await expandEnFaceSection('thickness');
        const occupied = count * cellLength;
        await expect($(SLIDER)).toHaveAttribute(
          'aria-valuemax',
          String(occupied + 0.1)
        );
        await threshold(occupied);
        await expectHighlighted(false, [15, 14]);
        await threshold(occupied + 0.1);
        await expectHighlighted(true, [15, 14]);
      }
      await expandEnFaceSection('projection');
      await setSlabRange(5, 6);
      await waitForEnFaceReady();
      await expect($(SLIDER)).toHaveAttribute('aria-valuemax', '0.1');
      await expectHighlighted(false, [15, 14]);
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }
});
