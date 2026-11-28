import JSZip from 'jszip';
import { test, expect } from '../fixtures';
import {
  buildSyntheticDicom,
  buildSyntheticCineDicom,
  newUid,
} from './syntheticDicom';

test.describe('DICOM archive state and independent clips', () => {
  test('restores the ruler saved with two series from one archive', async ({
    page,
    scratch,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const archive = new JSZip();
    const studyUid = newUid();
    for (const count of [2, 3]) {
      const seriesUid = newUid();
      for (let index = 0; index < count; index++) {
        archive.file(
          count + '-slice-' + index + '.dcm',
          buildSyntheticDicom({
            studyUid,
            seriesUid,
            sopUid: newUid(),
            instanceNumber: index + 1,
            seriesNumber: count,
            imageOrientationPatient: [1, 0, 0, 0, 1, 0],
            imagePositionPatient: [0, 0, index],
            rows: 32,
            cols: 32,
            pixelValue: 100 + index,
          })
        );
      }
    }
    const name = 'two-series-with-state.zip';
    scratch.writeFile(
      name,
      await archive.generateAsync({ type: 'nodebuffer' })
    );
    await volview.open('?urls=[tmp/' + name + ']');
    await volview.waitForVolumeCardSliceCounts([2, 3]);
    await volview.waitForViews();

    const view = volview.views2D.first();
    const { centerX: x, centerY: y } = await annotation.canvasCenter(view);
    await volview.selectTool('mdi-ruler');
    await annotation.clickAt(x - 30, y);
    await annotation.clickAt(x + 30, y);
    await segmentation.openSegmentShapes();
    const rulers = page.locator(
      '[data-testid="segment-shape-row"] i.mdi-ruler'
    );
    await expect(
      rulers,
      'Expected the placed ruler in the measurements list'
    ).toHaveCount(1);

    const saved = await volview.saveSession();
    await utils.openVolViewPage(saved);
    await segmentation.openSegmentShapes();
    await expect(
      rulers,
      'Expected the restored archive dataset to retain its ruler'
    ).toHaveCount(1);
    await page.locator('button[data-testid="module-tab-Data"]').click();
    await volview.waitForVolumeCardSliceCounts([2, 3]);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('plays two equal-shaped ultrasound clips sharing a series', async ({
    page,
    scratch,
    volview,
    utils,
    cine,
  }) => {
    const studyUid = newUid();
    const seriesUid = newUid();
    const files = ['first-clip.dcm', 'second-clip.dcm'].map((name) =>
      scratch.writeFile(
        name,
        buildSyntheticCineDicom({
          studyUid,
          seriesUid,
          sopUid: newUid(),
          rows: 32,
          cols: 32,
          numberOfFrames: 3,
        })
      )
    );
    await volview.open();
    await expect(page.locator('#app-container')).toBeVisible();
    await utils.dropFiles(files);
    await volview.waitForVolumeCardSliceCounts([3, 3]);
    await expect(page.locator('.play-controls').first()).toBeVisible();
    await cine.waitForFrame(1);
    await volview.focusFirst2DView();
    await cine.advanceCineFrame();
    await cine.waitForFrame(2);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
