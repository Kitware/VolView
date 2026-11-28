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
    utils,
    scratch,
    imageCache,
  }) => {
    const fileName = writeSingleSliceDicom(scratch);
    await utils.openFileThroughManifest(
      fileName,
      `single-slice-spacing-${Date.now()}.json`
    );

    expect(await imageCache.waitForFirstCachedImageSpacing()).toEqual([
      COLUMN_SPACING,
      ROW_SPACING,
      SPACING_BETWEEN_SLICES,
    ]);
  });
});
