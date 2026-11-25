import * as path from 'path';
import * as fs from 'fs';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

const DIR_NAME = 'dicom-unnamed-series';
const MANIFEST = 'dicom-unnamed-series.json';
const SERIES_UID = newUid();

describe('DICOM series without SeriesDescription or SeriesNumber', () => {
  before(() => {
    const dir = path.join(TEMP_DIR, DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const studyUid = newUid();
    const resources = [0, 1, 2].map((i) => {
      const filename = `slice-${i}.dcm`;
      const bytes = buildSyntheticDicom({
        studyUid,
        seriesUid: SERIES_UID,
        sopUid: newUid(),
        instanceNumber: i + 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, i],
      });
      fs.writeFileSync(path.join(dir, filename), bytes);
      return { url: `tmp/${DIR_NAME}/${filename}`, name: filename };
    });
    fs.writeFileSync(
      path.join(TEMP_DIR, MANIFEST),
      JSON.stringify({ resources })
    );
  });

  it('names the volume card by its SeriesInstanceUID', async () => {
    await volViewPage.open(`?urls=[tmp/${MANIFEST}]`);
    await volViewPage.waitForViews();
    await browser.waitUntil(
      async () => {
        const cards = await $$('.volume-card .series-desc');
        if ((await cards.length) !== 1) return false;
        return (await cards[0].getText()) === SERIES_UID;
      },
      { timeoutMsg: 'expected one volume card named by its SeriesInstanceUID' }
    );
  });
});
