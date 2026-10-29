import fs from 'node:fs';
import path from 'node:path';
import {
  attachMaskThroughDataPanel,
  waitForEnFaceReady,
  stageIllustrativeMask,
  stageGenericOCT,
  expectControlsBesideSelector,
  expandEnFaceSection,
  setSlabRange,
  setEnFaceWindow,
  slabThumb,
  getEnFaceWindow as getWindow,
  selectEnFace,
  selectTwoRowLayout,
  CANVAS,
} from './octTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  openThroughDialog,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';
import {
  openAnnotationSegments,
  selectSegment,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  reference,
  THRESHOLD,
  STEM,
  stageFixture,
  openControls,
  setThicknessThreshold,
  selectSetting,
  expectProjectionPixel,
  enableHighlight,
  dragEnFaceContrast,
  expectHighlight,
  expectStackedMaskWithoutSidebar,
  expectSliceLine,
  registerOctTestHooks,
} from './octInteractionTestUtils';

describe('Retinal OCT import', () => {
  registerOctTestHooks();
  it('builds stacked enface views with the layout grid after file import and attaches a segmentation through the Data panel', async () => {
    await browser.setViewport({
      width: 1440,
      height: 900,
      devicePixelRatio: 1,
    });
    const image = stageFixture('synthetic-oct.dcm');
    const mask = stageIllustrativeMask(makeTempDir(STEM));
    await volViewPage.open();
    await openThroughDialog(path.join(TEMP_DIR, image));
    await volViewPage.waitForViews();
    const spacing = await waitForFirstCachedImageSpacing();
    spacing.forEach((value, axis) =>
      expect(value).toBeCloseTo(reference.spacing[axis], 6)
    );
    expect(await $(CANVAS).isExisting()).toBe(false);

    await volViewPage.openLayoutMenu();
    expect(await volViewPage.getLayoutOptionTitles()).not.toContain(
      'Retinal OCT'
    );
    await browser.keys('Escape');
    await selectTwoRowLayout();
    await volViewPage.waitForViewCounts(2, false);
    await selectEnFace(1);
    await waitForEnFaceReady();
    expect((await volViewPage.getViews2D()).length).toBe(1);
    await expectSliceLine();

    await attachMaskThroughDataPanel(STEM + '/' + mask);
    await openAnnotationSegments();
    await waitForSegmentContent('Synthetic retinal layer');
    await selectSegment('Synthetic retinal layer');
    await expectStackedMaskWithoutSidebar();

    await openControls();
    await enableHighlight();
    expect(
      await $(
        '.v-overlay--active [data-testid="enface-segmentation-segment"]'
      ).getText()
    ).toContain('Synthetic retinal layer');
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await expectControlsBesideSelector();
    await browser.keys('Escape');
    await dragEnFaceContrast();
    const retainedWindow = await getWindow();
    const retainedSlice = await volViewPage.getFirst2DSlice();
    await selectTwoRowLayout();
    await expectHighlight(true);
    expect(await getWindow()).toEqual(retainedWindow);
    expect(await volViewPage.getFirst2DSlice()).toBe(retainedSlice);
    await expectSliceLine();
    await openControls();
    await expandEnFaceSection('thickness');
    expect(
      await $(
        '.v-overlay--active [data-testid="enface-segmentation-segment"]'
      ).getText()
    ).toContain('Synthetic retinal layer');
    expect(Number(await $(THRESHOLD).getValue())).toBe(31);
    await browser.keys('Escape');
    await volViewPage.focusFirst2DView();
    const before = await volViewPage.getFirst2DSlice();
    if (before === null)
      throw new Error('The original OCT has no slice position');
    await volViewPage.advanceSliceAndWait();
    expect(await volViewPage.getFirst2DSlice()).toBeLessThan(before);
    await expectSliceLine();
    await browser.keys('ArrowUp');
    await browser.waitUntil(
      async () => (await volViewPage.getFirst2DSlice()) === before
    );
    await expectSliceLine();

    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      fs.copyFileSync(
        path.join(TEMP_DIR, saved),
        path.join(captureDirectory, 'oct-production-saved-session.volview.zip')
      );
    }
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await volViewPage.waitForViews();
    await $(CANVAS).waitForDisplayed();
    await expectHighlight(true);
    await expectSliceLine();
    await expectStackedMaskWithoutSidebar();
    await volViewPage.waitForViewCounts(1, false);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  for (const format of ['nrrd', 'nii', 'vti'] as const) {
    it(
      'manually projects generated OCT pixels from ' +
        format +
        ' with an explicit axis and restores its settings',
      async () => {
        const directory = makeTempDir(STEM);
        const name = stageGenericOCT(directory, format);
        const projectionAxis = format === 'vti' ? 'Axial' : 'Coronal';
        await volViewPage.open();
        await openThroughDialog(path.join(directory, name));
        await volViewPage.waitForViews();
        expect(await $(CANVAS).isExisting()).toBe(false);
        const viewCount = (await $$('.view-type-select')).length;
        const spacing = await waitForFirstCachedImageSpacing();
        expect(Math.abs(spacing[0])).toBeCloseTo(reference.spacing[0], 6);
        expect(spacing[1]).toBeCloseTo(reference.spacing[2], 6);
        expect(spacing[2]).toBeCloseTo(reference.spacing[1], 6);
        if (format === 'vti') expect(spacing[0]).toBeLessThan(0);
        await selectEnFace();
        await waitForEnFaceReady();
        expect((await $$('.view-type-select')).length).toBe(viewCount);
        await openControls();
        expect(
          await $(
            '.v-overlay--active [data-testid="enface-projection-toggle"]'
          ).getAttribute('aria-expanded')
        ).toBe('true');
        await expandEnFaceSection('projection');
        await selectSetting('enface-projection-axis', projectionAxis);
        await waitForEnFaceReady();
        const display = await $(CANVAS).getSize();
        expect(display.width).toBeGreaterThan(0);
        expect(display.height).toBeGreaterThan(0);
        await setSlabRange(reference.slab.start, reference.slab.end);
        await waitForEnFaceReady();
        await browser.keys('Escape');
        await setEnFaceWindow(1000, 500);
        // Each container retains the same transposed source voxels.
        await expectProjectionPixel(76);
        const saved = await volViewPage.saveSession();
        await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
        await volViewPage.open();
        await openThroughDialog(path.join(TEMP_DIR, saved));
        await volViewPage.waitForViews();
        await $(CANVAS).waitForDisplayed();
        await waitForEnFaceReady();
        await openControls();
        await expandEnFaceSection('projection');
        expect(
          await $(
            '.v-overlay--active [data-testid="enface-projection-axis"] input'
          ).getValue()
        ).toBe(projectionAxis);
        await expect(slabThumb('start')).toHaveAttribute(
          'aria-valuenow',
          String(reference.slab.start)
        );
        await expect(slabThumb('end')).toHaveAttribute(
          'aria-valuenow',
          String(reference.slab.end)
        );
        await browser.keys('Escape');
        await expectProjectionPixel(76);
      }
    );
  }
});
