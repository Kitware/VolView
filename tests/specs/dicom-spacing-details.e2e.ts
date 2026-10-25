import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  buildSyntheticDicom,
  newUid,
  type SyntheticSliceOptions,
} from './syntheticDicom';
import { enhancedFixtureBytes } from '../fixtures/dicom-consumer/enhancedFixtures';
import { dropFiles, SESSION_SAVE_TIMEOUT, waitForFileExists } from './utils';

const dialog = () => $('[data-testid="image-spacing-details"]');
const axis = (name: string) =>
  dialog().$(`[data-testid="spacing-axis-${name}"]`);
const closeDetails = () => $('[data-testid="spacing-details-close"]').click();

async function openDetails() {
  await $('.volume-card [data-testid="dataset-menu-button"]').click();
  const item = $('[data-testid="dataset-menu-spacing-item"]');
  await item.waitForDisplayed();
  await item.waitForStable();
  await item.waitForClickable();
  await item.click();
  await dialog().waitForDisplayed();
}

function slice(options: Partial<SyntheticSliceOptions> = {}) {
  return buildSyntheticDicom({
    studyUid: newUid(),
    seriesUid: newUid(),
    sopUid: newUid(),
    instanceNumber: 1,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [0, 0, 0],
    rows: 4,
    cols: 4,
    pixelSpacing: [0.5, 0.25],
    pixelValue: 80,
    ...options,
  });
}

async function openFile(name: string, bytes: Uint8Array, slices = 1) {
  writeFileSync(join(TEMP_DIR, name), bytes);
  await volViewPage.open(`?urls=[tmp/${name}]`);
  await volViewPage.waitForVolumeCardSliceCounts([slices]);
  await openDetails();
}

describe('DICOM physical spacing details', () => {
  it('identifies unknown physical units in a public secondary capture', async () => {
    await volViewPage.open('?urls=[tmp/dicom-corpus-image_dfl.dcm]');
    await volViewPage.waitForVolumeCardSliceCounts([1]);
    await openDetails();
    await expect(axis('X')).toHaveText(
      expect.stringContaining('physical unit unknown')
    );
    await expect(axis('Y')).toHaveText(
      expect.stringContaining('Assumed: Display default')
    );
    await expect(dialog()).toHaveText(
      expect.stringContaining('They do not establish a physical distance.')
    );
  });

  it('updates derived spacing after another slice arrives and restores it with the session', async () => {
    const studyUid = newUid();
    const seriesUid = newUid();
    const first = slice({ studyUid, seriesUid });
    const secondName = 'spacing-second.dcm';
    writeFileSync(
      join(TEMP_DIR, secondName),
      slice({
        studyUid,
        seriesUid,
        instanceNumber: 2,
        imagePositionPatient: [0, 0, 2],
      })
    );
    await openFile('spacing-first.dcm', first);
    await expect(axis('X')).toHaveText(expect.stringContaining('0.25 mm'));
    await expect(axis('X')).toHaveText(
      expect.stringContaining('Declared: PixelSpacing')
    );
    await expect(axis('Z')).toHaveText(expect.stringContaining('One sample'));
    await expect(axis('Z')).toHaveText(
      expect.stringContaining('physical unit unknown')
    );
    await closeDetails();

    await dropFiles([join(TEMP_DIR, secondName)]);
    await volViewPage.waitForVolumeCardSliceCounts([2]);
    await openDetails();
    await expect(axis('Z')).toHaveText(expect.stringContaining('2 mm'));
    await expect(axis('Z')).toHaveText(
      expect.stringContaining('Derived: ImagePositionPatient')
    );
    await closeDetails();

    const saved = await volViewPage.saveSession();
    await waitForFileExists(join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open(`?urls=[tmp/${saved}]`);
    await volViewPage.waitForVolumeCardSliceCounts([2]);
    await openDetails();
    await expect(axis('X')).toHaveText(expect.stringContaining('0.25 mm'));
    await expect(axis('Z')).toHaveText(
      expect.stringContaining('Derived: ImagePositionPatient')
    );
    await browser.saveScreenshot(join(TEMP_DIR, 'dicom-spacing-details.png'));
  });

  it('preserves the valid axis when the other PixelSpacing value is unusable', async () => {
    await openFile('spacing-partial.dcm', slice({ pixelSpacing: [0, 0.25] }));
    await expect(axis('X')).toHaveText(expect.stringContaining('0.25 mm'));
    await expect(axis('X')).toHaveText(
      expect.stringContaining('Declared: PixelSpacing')
    );
    await expect(axis('Y')).toHaveText(
      expect.stringContaining('physical unit unknown')
    );
    await expect(axis('Y')).toHaveText(
      expect.stringContaining('no usable positive spacing')
    );
  });

  it('reports the declared step of a single-file multiframe volume', async () => {
    await openFile(
      'spacing-multiframe.dcm',
      slice({ framePixelValues: [40, 80], spacingBetweenSlices: 1.5 }),
      2
    );
    await expect(axis('Z')).toHaveText(expect.stringContaining('1.5 mm'));
    await expect(axis('Z')).toHaveText(
      expect.stringContaining('Declared: SpacingBetweenSlices')
    );
  });

  it('identifies the ultrasound unit conversion and its region scope', async () => {
    await openFile(
      'spacing-ultrasound.dcm',
      slice({
        modality: 'US',
        sopClassUid: '1.2.840.10008.5.1.4.1.1.6.1',
        ultrasoundRegion: { physicalDeltaX: 0.05, physicalDeltaY: 0.03 },
      })
    );
    await expect(axis('X')).toHaveText(expect.stringContaining('0.5 mm'));
    await expect(axis('Y')).toHaveText(expect.stringContaining('0.3 mm'));
    await expect(dialog()).toHaveText(
      expect.stringContaining('cm converted to mm')
    );
    await expect(dialog()).toHaveText(
      expect.stringContaining('not necessarily the entire image')
    );
  });

  it('keeps physical units distinct from an approximate reconstruction', async () => {
    await openFile(
      'spacing-uneven.dcm',
      enhancedFixtureBytes({
        pixelValues: [20, 80, 140],
        positions: [
          [0, 0, 0],
          [0, 0, 1],
          [0, 0, 3],
        ],
      }),
      3
    );
    await expect(axis('X')).toHaveText(expect.stringContaining('mm'));
    await expect(dialog()).toHaveText(
      expect.stringContaining('Slices are not evenly spaced.')
    );
    await expect(dialog()).toHaveText(
      expect.stringContaining('The displayed grid is approximate')
    );
  });
});
