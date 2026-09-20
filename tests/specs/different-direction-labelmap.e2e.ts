import { PROSTATE_610_LABELMAP_MANIFEST } from './configTestUtils';
import { writeManifestToFile } from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openAnnotationSegments,
  waitForNamedSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';

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
describe('Labelmap with different direction matrix', () => {
  it('paint tool works on coronal view', async () => {
    const config = {
      layouts: {
        'Coronal Only': [['coronal']],
      },
    };

    const manifestFileName = 'different-direction-labelmap.volview.json';
    await writeManifestToFile(PROSTATE_610_LABELMAP_MANIFEST, manifestFileName);

    const configFileName = 'different-direction-labelmap-config.json';
    await writeManifestToFile(config, configFileName);

    const urlParams = `?urls=[tmp/${manifestFileName},tmp/${configFileName}]`;
    await volViewPage.open(urlParams);
    await volViewPage.waitForViews();
    const notifications = await volViewPage.getNotificationsCount();
    expect(notifications).toEqual(0);

    await openAnnotationSegments();
    await waitForNamedSegments();
    await waitForSegmentContent('Right hip');

    await volViewPage.openLayoutMenu(1);
    await volViewPage.selectLayoutOption('Coronal Only');
    await volViewPage.waitForViewCounts(1, false);

    await volViewPage.focusFirst2DView();
    await volViewPage.advanceSliceAndWait();
    await volViewPage.advanceSliceAndWait();
    await volViewPage.advanceSliceAndWait();

    await volViewPage.activatePaint();

    const views2D = await volViewPage.getViews2D();
    const coronalView = views2D[0];
    const canvas = await coronalView.$('canvas');

    const location = await canvas.getLocation();
    const size = await canvas.getSize();
    const centerX = location.x + size.width / 2;
    const centerY = location.y + size.height / 2;

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX), y: Math.round(centerY) })
      .down()
      .move({ x: Math.round(centerX + 40), y: Math.round(centerY) })
      .move({ x: Math.round(centerX + 40), y: Math.round(centerY + 40) })
      .up()
      .perform();

    await browser.waitUntil(
      async () => {
        const result = await browser.checkElement(
          coronalView,
          'different_direction_labelmap_paint_coronal'
        );
        return (result as number) < 5;
      },
      {
        timeout: 10000,
        timeoutMsg:
          'Paint stroke on coronal view with misaligned labelmap should match baseline',
        interval: 1000,
      }
    );
  });
});
