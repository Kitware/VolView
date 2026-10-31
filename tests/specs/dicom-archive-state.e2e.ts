import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  buildSyntheticDicom,
  buildSyntheticCineDicom,
  newUid,
} from './syntheticDicom';
import { canvasCenter, clickAt } from './annotationTestUtils';
import { advanceCineFrame, waitForFrame } from './cineTestUtils';
import { openSegmentShapes } from './segmentationTestUtils';
import {
  dropFiles,
  openVolViewPage,
  SESSION_SAVE_TIMEOUT,
  waitForFileExists,
} from './utils';

describe('DICOM archive state and independent clips', () => {
  it('restores the ruler saved with two series from one archive', async () => {
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
    writeFileSync(
      join(TEMP_DIR, name),
      await archive.generateAsync({ type: 'nodebuffer' })
    );
    await volViewPage.open('?urls=[tmp/' + name + ']');
    await volViewPage.waitForVolumeCardSliceCounts([2, 3]);
    await volViewPage.waitForViews();

    const view = (await volViewPage.getViews2D())[0];
    const { centerX: x, centerY: y } = await canvasCenter(view);
    await volViewPage.selectTool('mdi-ruler');
    await clickAt(x - 30, y);
    await clickAt(x + 30, y);
    await openSegmentShapes();
    const rulerCount = () =>
      $$('[data-testid="segment-shape-row"] i.mdi-ruler').length;
    await browser.waitUntil(async () => (await rulerCount()) === 1, {
      timeoutMsg: 'Expected the placed ruler in the measurements list',
    });

    const saved = await volViewPage.saveSession();
    await waitForFileExists(join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await openVolViewPage(saved);
    await openSegmentShapes();
    await browser.waitUntil(async () => (await rulerCount()) === 1, {
      timeoutMsg: 'Expected the restored archive dataset to retain its ruler',
    });
    await $('button[data-testid="module-tab-Data"]').click();
    await volViewPage.waitForVolumeCardSliceCounts([2, 3]);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('plays two equal-shaped ultrasound clips sharing a series', async () => {
    const studyUid = newUid();
    const seriesUid = newUid();
    const files = ['first-clip.dcm', 'second-clip.dcm'].map((name) => {
      const file = join(TEMP_DIR, name);
      writeFileSync(
        file,
        buildSyntheticCineDicom({
          studyUid,
          seriesUid,
          sopUid: newUid(),
          rows: 32,
          cols: 32,
          numberOfFrames: 3,
        })
      );
      return file;
    });
    await volViewPage.open();
    await $('#app-container').waitForDisplayed();
    await dropFiles(files);
    await volViewPage.waitForVolumeCardSliceCounts([3, 3]);
    await $('.play-controls').waitForDisplayed();
    await waitForFrame(1);
    await volViewPage.focusFirst2DView();
    await advanceCineFrame();
    await waitForFrame(2);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
