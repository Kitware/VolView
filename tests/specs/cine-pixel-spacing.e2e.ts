import { test, expect } from '../fixtures';
import type { Scratch } from '../scratch';
import { buildSyntheticCineDicom, newUid } from './syntheticDicom';

const ROW_SPACING = 1.8;
const COLUMN_SPACING = 0.45;

function writeCineDicom(scratch: Scratch) {
  const fileName = `cine-pixel-spacing-${Date.now()}.dcm`;

  scratch.writeFile(
    fileName,
    buildSyntheticCineDicom({
      studyUid: newUid(),
      seriesUid: newUid(),
      sopUid: newUid(),
      numberOfFrames: 4,
      rows: 6,
      cols: 7,
      pixelSpacing: [ROW_SPACING, COLUMN_SPACING],
    })
  );

  return fileName;
}

test.describe('Cine DICOM PixelSpacing', () => {
  test('falls back to PixelSpacing when ultrasound regions are unusable', async ({
    utils,
    imageCache,
    scratch,
  }) => {
    const fileName = writeCineDicom(scratch);
    await utils.openFileThroughManifest(
      fileName,
      `cine-pixel-spacing-${Date.now()}.json`
    );

    expect(await imageCache.waitForFirstCachedImageSpacing()).toEqual([
      COLUMN_SPACING,
      ROW_SPACING,
      1,
    ]);
  });
});
