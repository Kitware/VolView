import { test, expect } from '../fixtures';
import { HIDE_VIEW_ANNOTATIONS } from '../pageobjects/volview.page';
import { PROSTATE_610_LABELMAP_MANIFEST } from './configTestUtils';

const MAX_MISMATCH_RATIO = 0.0001;

/**
 * Regression test for labelmap with different direction matrix than parent image.
 *
 * The prostate DICOM and TotalSegmenter segment group have different direction matrices:
 *   Base image:     [1, 0, 0,  0,  0.97, -0.24,  0, 0.24, 0.97]
 *   Labelmap:       [1, 0, 0,  0, -0.97,  0.24,  0, 0.24, 0.97]
 *
 * This caused bugs where paint tool painted at wrong location and
 * coronal slice didn't show segment overlay.
 */
test.describe('Labelmap with different direction matrix', () => {
  test('paint tool works on coronal view', async ({
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const config = {
      layouts: {
        'Coronal Only': [['coronal']],
      },
    };

    const manifestFileName = 'different-direction-labelmap.volview.json';
    await utils.writeManifestToFile(
      PROSTATE_610_LABELMAP_MANIFEST,
      manifestFileName
    );

    const configFileName = 'different-direction-labelmap-config.json';
    await utils.writeManifestToFile(config, configFileName);

    const urlParams = `?urls=[tmp/${manifestFileName},tmp/${configFileName}]`;
    await volview.open(urlParams);
    await volview.waitForViews();
    const notifications = await volview.getNotificationsCount();
    expect(notifications).toEqual(0);

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.waitForSegmentContent('Right hip');
    // The manifest describes one of the labelmap's values; the rest keep a row.
    expect((await segmentation.segmentNames()).length).toBeGreaterThan(1);

    await volview.openLayoutMenu(1);
    await volview.selectLayoutOption('Coronal Only');
    await volview.waitForViewCounts(1, false);

    await volview.focusFirst2DView();
    await volview.advanceSliceAndWait();
    await volview.advanceSliceAndWait();
    await volview.advanceSliceAndWait();

    await volview.activatePaint();

    const coronalView = volview.views2D.first();
    await annotation.dragFromViewCenter(coronalView, [
      [40, 0],
      [40, 40],
    ]);

    await annotation.moveTo(10, 10);
    await expect(
      coronalView,
      `Painted coronal view with misaligned labelmap should match its baseline within ${MAX_MISMATCH_RATIO * 100}%`
    ).toHaveScreenshot('different_direction_labelmap_paint_coronal.png', {
      stylePath: HIDE_VIEW_ANNOTATIONS,
      maxDiffPixelRatio: MAX_MISMATCH_RATIO,
    });
  });
});
