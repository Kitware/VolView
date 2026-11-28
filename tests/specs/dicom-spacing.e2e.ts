import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { test, expect } from '../fixtures';
import type { Scratch } from '../scratch';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

const ROW_SPACING = 2.5;
const COLUMN_SPACING = 0.75;
const SPACING_BETWEEN_SLICES = 7.25;

function writeSingleSliceDicom(scratch: Scratch) {
  const fileName = `single-slice-spacing-${Date.now()}.dcm`;
  const studyUid = newUid();
  const seriesUid = newUid();

  scratch.writeFile(
    fileName,
    buildSyntheticDicom({
      studyUid,
      seriesUid,
      sopUid: newUid(),
      instanceNumber: 1,
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      imagePositionPatient: [0, 0, 0],
      rows: 5,
      cols: 6,
      pixelSpacing: [ROW_SPACING, COLUMN_SPACING],
      spacingBetweenSlices: SPACING_BETWEEN_SLICES,
      sliceThickness: 19,
    })
  );

  return fileName;
}

test.describe('DICOM image spacing', () => {
  test('matches ITK spacing for single-slice images with SpacingBetweenSlices', async ({
    volview,
    utils,
    scratch,
    segmentation,
    saveDownload,
  }) => {
    const fileName = writeSingleSliceDicom(scratch);
    await utils.openFileThroughManifest(
      fileName,
      `single-slice-spacing-${Date.now()}.json`
    );
    await volview.waitForViews();

    // One slice has no on-screen depth; a saved segmentation carries the grid.
    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());
    await segmentation.openAnnotationSegments();
    await volview.clickSaveSegmentsButton();
    const saved = fs.readFileSync(
      await saveDownload(() => volview.saveSegmentsConfirmButton.click())
    );
    const nrrd = saved[0] === 0x1f ? zlib.gunzipSync(saved) : saved;
    const header = nrrd.toString('latin1').split('\n\n')[0];
    expect(header).toContain(
      `space directions: (${COLUMN_SPACING},0,0) (0,${ROW_SPACING},0) (0,0,${SPACING_BETWEEN_SLICES})`
    );
  });
});
