import fs from 'node:fs';
import path from 'node:path';
import { test, expect, registerOctTestHooks } from '../fixtures';
import { stageIllustrativeMask, stageGenericOCT, CANVAS } from './octTestUtils';
import {
  reference,
  STEM,
  SYNTHETIC_OCT_GEOMETRY,
  SYNTHETIC_OCT_PROBE_POINTS,
} from './octInteractionTestUtils';
import { syntheticOCTGrid } from '../fixtures/oct/volumes';

test.describe('Retinal OCT import', () => {
  registerOctTestHooks();
  test('builds stacked enface views with the layout grid after file import and attaches a segmentation through the Data panel', async ({
    page,
    volview,
    utils,
    scratch,
    oct,
    octInteraction,
    probe,
    segmentation,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const image = octInteraction.stageFixture('synthetic-oct.dcm');
    const mask = stageIllustrativeMask(utils.makeTempDir(STEM));
    await volview.open();
    await utils.openThroughDialog(scratch.path(image));
    await volview.waitForViews();
    await probe.expectProbedPositions(
      volview.views2D.first(),
      SYNTHETIC_OCT_GEOMETRY,
      SYNTHETIC_OCT_PROBE_POINTS
    );
    expect(await page.locator(CANVAS).count()).toBe(0);

    await volview.openLayoutMenu();
    expect(await volview.getLayoutOptionTitles()).not.toContain('Retinal OCT');
    await page.keyboard.press('Escape');
    await oct.selectTwoRowLayout();
    await volview.waitForViewCounts(2, false);
    await oct.selectEnFace(1);
    await oct.waitForEnFaceReady();
    await expect(volview.views2D).toHaveCount(1);
    await octInteraction.expectSliceLine();

    await oct.attachMaskThroughDataPanel(STEM + '/' + mask);
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent('Synthetic retinal layer');
    await segmentation.selectSegment('Synthetic retinal layer');
    await octInteraction.expectStackedMaskWithoutSidebar();

    await oct.openEnFaceControls();
    await oct.setSegmentThreshold('Synthetic retinal layer', 31);
    await oct.expectHighlight(true);
    await oct.expectControlsBesideSelector();
    await page.keyboard.press('Escape');
    await octInteraction.dragEnFaceContrast();
    const retainedWindow = await oct.getEnFaceWindow();
    const retainedSlice = await volview.getFirst2DSlice();
    await oct.selectTwoRowLayout();
    await oct.expectHighlight(true);
    expect(await oct.getEnFaceWindow()).toEqual(retainedWindow);
    expect(await volview.getFirst2DSlice()).toBe(retainedSlice);
    await octInteraction.expectSliceLine();
    await oct.expectEnFaceSegmentShown('Synthetic retinal layer', '31');
    await volview.focusFirst2DView();
    const before = await volview.getFirst2DSlice();
    if (before === undefined)
      throw new Error('The original OCT has no slice position');
    await volview.advanceSliceAndWait();
    expect(await volview.getFirst2DSlice()).toBeLessThan(before);
    await octInteraction.expectSliceLine();
    await page.keyboard.press('ArrowUp');
    await expect.poll(volview.getFirst2DSlice).toBe(before);
    await octInteraction.expectSliceLine();

    const saved = await volview.saveSession();
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      fs.copyFileSync(
        scratch.path(saved),
        path.join(captureDirectory, 'oct-production-saved-session.volview.zip')
      );
    }
    await volview.open('?urls=[tmp/' + saved + ']');
    await volview.waitForViews();
    await expect(page.locator(CANVAS).first()).toBeVisible();
    await oct.expectHighlight(true);
    await octInteraction.expectSliceLine();
    await octInteraction.expectStackedMaskWithoutSidebar();
    await volview.waitForViewCounts(1, false);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  for (const format of ['nrrd', 'nii', 'vti'] as const) {
    test(
      'manually projects generated OCT pixels from ' +
        format +
        ' with an explicit axis and restores its settings',
      async ({ page, volview, utils, scratch, oct, octInteraction, probe }) => {
        const directory = utils.makeTempDir(STEM);
        const name = stageGenericOCT(directory, format);
        const projectionAxis = format === 'vti' ? 'Axial' : 'Coronal';
        await volview.open();
        await utils.openThroughDialog(path.join(directory, name));
        await volview.waitForViews();
        expect(await page.locator(CANVAS).count()).toBe(0);
        const viewCount = await page.locator('.view-type-select').count();
        const grid = syntheticOCTGrid();
        const [sx, sz, sy] = grid.spacing;
        await probe.expectProbedPositions(
          volview.views2D.first(),
          format === 'vti'
            ? { origin: [0, 0, 0], spacing: [-sx, sz, sy] }
            : {
                origin: [0, 0, 0],
                spacing: grid.spacing,
                direction: grid.direction,
              },
          SYNTHETIC_OCT_PROBE_POINTS
        );
        await oct.selectEnFace();
        await oct.waitForEnFaceReady();
        await expect(page.locator('.view-type-select')).toHaveCount(viewCount);
        await oct.openEnFaceControls();
        expect(
          await page
            .locator(
              '.v-overlay--active [data-testid="enface-projection-toggle"]'
            )
            .getAttribute('aria-expanded')
        ).toBe('true');
        await oct.expandEnFaceSection();
        await oct.selectSetting('enface-projection-axis', projectionAxis);
        await oct.waitForEnFaceReady();
        const display = await page.locator(CANVAS).first().boundingBox();
        expect(display?.width).toBeGreaterThan(0);
        expect(display?.height).toBeGreaterThan(0);
        await oct.setSlabRange(reference.slab.start, reference.slab.end);
        await oct.waitForEnFaceReady();
        await page.keyboard.press('Escape');
        await oct.setEnFaceWindow(1000, 500);
        // Each container retains the same transposed source voxels.
        await octInteraction.expectProjectionPixel(76);
        const saved = await volview.saveSession();
        await volview.open();
        await utils.openThroughDialog(scratch.path(saved));
        await volview.waitForViews();
        await expect(page.locator(CANVAS).first()).toBeVisible();
        await oct.waitForEnFaceReady();
        await oct.openEnFaceProjection();
        expect(
          await page
            .locator(
              '.v-overlay--active [data-testid="enface-projection-axis"] input'
            )
            .inputValue()
        ).toBe(projectionAxis);
        await expect(oct.slabThumb('start')).toHaveAttribute(
          'aria-valuenow',
          String(reference.slab.start)
        );
        await expect(oct.slabThumb('end')).toHaveAttribute(
          'aria-valuenow',
          String(reference.slab.end)
        );
        await page.keyboard.press('Escape');
        await octInteraction.expectProjectionPixel(76);
      }
    );
  }
});
