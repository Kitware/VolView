import * as fs from 'fs';
import * as path from 'path';

import { test, expect } from '../fixtures';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import type { Utils } from './utils';

const PUBLIC_DSC_SERIES_UID =
  '1.3.6.1.4.1.9590.100.1.2.284777661700890778225181143863199482857';
const PUBLIC_DSC_SLOPE = 112067.85375182;
const STORED_VALUES = [0, 2, 65131];
const ROWS = 4;
const COLUMNS = 4;

async function writeRescaledSeries(utils: Utils) {
  const dirName = `modality-rescale-${Date.now()}`;
  const dir = utils.makeTempDir(dirName);

  const studyUid = newUid();
  const resources = STORED_VALUES.map((pixelValue, index) => {
    const filename = `slice-${index}.dcm`;
    fs.writeFileSync(
      path.join(dir, filename),
      buildSyntheticDicom({
        studyUid,
        seriesUid: PUBLIC_DSC_SERIES_UID,
        sopUid: newUid(),
        instanceNumber: index + 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, index],
        rows: ROWS,
        cols: COLUMNS,
        bitsAllocated: 16,
        bitsStored: 16,
        highBit: 15,
        pixelRepresentation: 0,
        rescaleSlope: PUBLIC_DSC_SLOPE,
        rescaleIntercept: 0,
        pixelValue,
      })
    );
    return { url: `tmp/${dirName}/${filename}`, name: filename };
  });

  const manifestName = `modality-rescale-${Date.now()}.json`;
  await utils.writeManifestToFile({ resources }, manifestName);
  return manifestName;
}

test.describe('DICOM modality rescale', () => {
  test('preserves the public DSC series Float64 output through volume loading', async ({
    page,
    volview,
    utils,
    probe,
  }) => {
    const manifestName = await writeRescaledSeries(utils);
    await volview.open(`?urls=[tmp/${manifestName}]`);
    await volview.waitForViews();
    const view = volview.views2D.first();
    await volview.waitForLoadingIndicator(view);

    expect(await volview.getNotificationsCount()).toBe(0);
    await volview.focusFirst2DView();
    for (let press = 0; press < STORED_VALUES.length; press++)
      await page.keyboard.press('ArrowDown');
    const shown = new Map<number, string>();
    for (let slice = 1; slice <= STORED_VALUES.length; slice++) {
      if (slice > 1) await page.keyboard.press('ArrowUp');
      await expect(view).toContainText(
        `Slice: ${slice}/${STORED_VALUES.length}`
      );
      const readout = await probe.probeAt(view, 0.5, 0.5);
      shown.set(readout.position[2], readout.samples[0]);
    }
    // Two decimals tell Float64 from Float32 here: 2 * slope is 224135.7075.
    STORED_VALUES.forEach((stored, index) => {
      const text = shown.get(index);
      if (text === undefined)
        throw new Error(`No slice was probed at z = ${index}`);
      const decimals = text.split('.')[1]?.length ?? 0;
      expect(
        Math.abs(Number(text) - stored * PUBLIC_DSC_SLOPE),
        `Probed value ${text} at z = ${index}`
      ).toBeLessThanOrEqual(0.5 * 10 ** -decimals);
    });
  });
});
