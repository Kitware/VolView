import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

test.describe('DICOM primary selection', () => {
  for (const modalities of [
    ['OPT', 'US'],
    ['CT', 'US'],
    ['CT', 'DX'],
  ]) {
    test(`prefers ${modalities[0]} when loading ${modalities.join(' and ')}`, async ({
      page,
      volview,
      utils,
    }) => {
      const directory = `primary-${modalities.join('-')}`;
      const target = utils.makeTempDir(directory);
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
      await utils.writeManifestToFile({ resources }, manifest);
      await volview.open(`?urls=[tmp/${manifest}]`);
      await volview.waitForViews();
      await expect(page.locator('.volume-card')).toHaveCount(modalities.length);
      await expect(page.locator('.volume-card-active .series-desc')).toHaveText(
        '1'
      );
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }
});
