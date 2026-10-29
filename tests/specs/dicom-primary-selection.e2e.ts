import fs from 'node:fs';
import path from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { makeTempDir, writeManifestToFile } from './utils';

describe('DICOM primary selection', () => {
  for (const modalities of [
    ['OPT', 'US'],
    ['CT', 'US'],
    ['CT', 'DX'],
  ]) {
    it(`prefers ${modalities[0]} when loading ${modalities.join(' and ')}`, async () => {
      const directory = `primary-${modalities.join('-')}`;
      const target = makeTempDir(directory);
      const studyUid = newUid();
      const resources = modalities.map((modality, index) => {
        const name = `${modality}.dcm`;
        fs.writeFileSync(
          path.join(target, name),
          buildSyntheticDicom({
            studyUid,
            seriesUid: newUid(),
            sopUid: newUid(),
            instanceNumber: 1,
            seriesNumber: index + 1,
            modality,
            imageOrientationPatient: [1, 0, 0, 0, 1, 0],
            imagePositionPatient: [0, 0, 0],
          })
        );
        return { url: `tmp/${directory}/${name}`, name };
      });
      const manifest = `${directory}.json`;
      await writeManifestToFile({ resources }, manifest);
      await volViewPage.open(`?urls=[tmp/${manifest}]`);
      await volViewPage.waitForViews();
      await browser.waitUntil(
        async () => (await $$('.volume-card').length) === modalities.length
      );
      await expect($('.volume-card-active .series-desc')).toHaveText('1');
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }
});
