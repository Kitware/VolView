import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  buildSyntheticDicom,
  newUid,
  rawElement,
  type SyntheticSliceOptions,
} from './syntheticDicom';
import {
  dropFiles,
  makeTempDir,
  openVolumeInfo,
  SESSION_SAVE_TIMEOUT,
  waitForFileExists,
} from './utils';

const dialog = () => $('[data-testid="volume-info"]');
const axis = (name: string) =>
  dialog().$(`[data-testid="spacing-axis-${name}"]`);
const step = (name: string) => axis(name).$('td:nth-child(2)');
async function closeDetails() {
  await $(
    '.v-dialog.v-overlay--active .closeable-dialog button.close-button'
  ).click();
  await dialog().waitForDisplayed({ reverse: true });
}

function slice(options: Partial<SyntheticSliceOptions> = {}) {
  return buildSyntheticDicom({
    studyUid: newUid(),
    seriesUid: newUid(),
    sopUid: newUid(),
    instanceNumber: 1,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [0, 0, 0],
    pixelSpacing: [0.5, 0.25],
    pixelValue: 80,
    ...options,
  });
}

async function openFile(name: string, bytes: Uint8Array, slices = 1) {
  writeFileSync(join(TEMP_DIR, name), bytes);
  await volViewPage.open(`?urls=[tmp/${name}]`);
  await volViewPage.waitForVolumeCardSliceCounts([slices]);
  await openVolumeInfo();
}

describe('Volume Info dialog', () => {
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
    await expect(step('X')).toHaveText('0.25');
    await expect(axis('Z')).toHaveText(expect.stringContaining('One sample'));
    await closeDetails();

    await dropFiles([join(TEMP_DIR, secondName)]);
    await volViewPage.waitForVolumeCardSliceCounts([2]);
    await openVolumeInfo();
    await expect(step('Z')).toHaveText('2');
    await closeDetails();

    const saved = await volViewPage.saveSession();
    await waitForFileExists(join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open(`?urls=[tmp/${saved}]`);
    await volViewPage.waitForVolumeCardSliceCounts([2]);
    await openVolumeInfo();
    await expect(step('X')).toHaveText('0.25');
    await expect(step('Z')).toHaveText('2');
  });

  it('preserves the valid axis when the other PixelSpacing value is unusable', async () => {
    await openFile('spacing-partial.dcm', slice({ pixelSpacing: [0, 0.25] }));
    await expect(step('X')).toHaveText('0.25');
  });

  it('reports the declared step of a single-file multiframe volume', async () => {
    await openFile(
      'spacing-multiframe.dcm',
      slice({ framePixelValues: [40, 80], spacingBetweenSlices: 1.5 }),
      2
    );
    await expect(step('Z')).toHaveText('1.5');
  });

  it('converts ultrasound region spacing from cm to mm', async () => {
    await openFile(
      'spacing-ultrasound.dcm',
      slice({
        modality: 'US',
        sopClassUid: '1.2.840.10008.5.1.4.1.1.6.1',
        ultrasoundRegion: { physicalDeltaX: 0.05, physicalDeltaY: 0.03 },
      })
    );
    await expect(step('X')).toHaveText('0.5');
    await expect(step('Y')).toHaveText('0.3');
  });

  it('describes a non-DICOM image without DICOM sections', async () => {
    const directory = makeTempDir('volume-info-nrrd');
    const header = [
      'NRRD0005',
      'type: unsigned char',
      'dimension: 3',
      'sizes: 4 3 2',
      'space: left-posterior-superior',
      'space directions: (0,0.5,0) (-0.25,0,0) (0,0,2)',
      'space origin: (10,20,30)',
      'encoding: ascii',
    ].join('\n');
    const values = Array.from({ length: 24 }, (_, index) => index).join(' ');
    writeFileSync(join(directory, 'grid.nrrd'), `${header}\n\n${values}`);
    await volViewPage.open('?urls=[tmp/volume-info-nrrd/grid.nrrd]');
    await volViewPage.waitForViews();
    await openVolumeInfo();
    await expect(dialog()).toHaveText(expect.stringContaining('grid.nrrd'));
    await expect($('[data-testid="volume-info-Dimensions"]')).toHaveText(
      expect.stringContaining('4, 3, 2')
    );
    await expect($('[data-testid="volume-info-Origin"]')).toHaveText(
      expect.stringContaining('10, 20, 30')
    );
    await expect($('[data-testid="volume-info-X direction"]')).toHaveText(
      expect.stringContaining('0, 1, 0')
    );
    await expect(step('X')).toHaveText('0.5');
    await expect(step('Y')).toHaveText('0.25');
    await expect(step('Z')).toHaveText('2');
    await expect(dialog()).not.toHaveText(
      expect.stringContaining('Patient and study')
    );
    await expect(dialog().$('[data-testid="volume-info-tags"]')).not.toExist();
    await closeDetails();

    const viewInfo = $('[data-testid="view-info-button"]');
    await viewInfo.waitForClickable();
    await viewInfo.click();
    await expect(dialog()).toHaveText(expect.stringContaining('grid.nrrd'));
  });

  it('lists study details and the first instance tags, and opens from the view', async () => {
    await openFile(
      'volume-info-tags.dcm',
      slice({
        patientId: 'INFO-PATIENT-7',
        seriesNumber: 42,
        extraElements: [
          rawElement(
            0x0040,
            0x0280,
            'ST',
            new TextEncoder().encode('A'.repeat(300))
          ),
        ],
      })
    );
    await expect(dialog()).toHaveText(
      expect.stringContaining('INFO-PATIENT-7')
    );
    await expect(dialog()).toHaveText(expect.stringContaining('Series number'));
    // Double-click the text itself, which sits at the start of a wide cell.
    const seriesNumber = $(
      '[data-testid="volume-info-Series number"] td:nth-child(2)'
    );
    const { width } = await seriesNumber.getSize();
    await browser
      .action('pointer')
      .move({ origin: seriesNumber, x: Math.round(18 - width / 2), y: 0 })
      .down()
      .up()
      .down()
      .up()
      .perform();
    await expect(
      browser.execute(() => window.getSelection()?.toString().trim())
    ).resolves.toBe('42');
    await dialog().$('[data-testid="volume-info-tags"] button').click();
    const filter = dialog().$('[data-testid="volume-info-tags"] input');
    await filter.waitForStable();
    await filter.waitForClickable();
    await expect(
      dialog().$('[data-testid="volume-info-tags"] thead')
    ).toHaveText(expect.stringMatching(/Tag\s+Name\s+VR\s+Value/));
    await filter.setValue('SeriesNumber');
    const rows = dialog().$$('[data-testid="volume-info-tag"]');
    await expect(rows).toBeElementsArrayOfSize(1);
    await expect(rows[0]).toHaveText(
      expect.stringMatching(/\(0020,0011\)\s+SeriesNumber\s+IS\s+42/)
    );
    await dialog()
      .$('[data-testid="volume-info-tags"] .v-field__clearable .v-icon')
      .click();
    await expect(
      dialog().$$('[data-testid="volume-info-tag"]')
    ).toBeElementsArrayOfSize({ gte: 10 });
    await filter.setValue('CommentsOnThePerformedProcedureStep');
    const comment = dialog().$$('[data-testid="volume-info-tag"]');
    await expect(comment).toBeElementsArrayOfSize(1);
    await expect(comment[0]).toHaveText(
      expect.stringContaining(`${'A'.repeat(256)}… (300 characters)`)
    );
    await expect(dialog()).toHaveText(
      expect.stringContaining('Transfer syntax: 1.2.840.10008.1.2.1.')
    );
    await closeDetails();

    await volViewPage.waitForViews();
    const viewInfo = $('[data-testid="view-info-button"]');
    await viewInfo.waitForClickable();
    await viewInfo.click();
    await expect(dialog()).toHaveText(
      expect.stringContaining('INFO-PATIENT-7')
    );
  });
});
