import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { writeConfigImages } from './configurationImage';
import {
  openAnnotationSegments,
  segmentNames,
  waitForNamedSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  writeManifestToFile,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';

const openConfigured = async (config: unknown) => {
  const stem = 'segmentation-config-case';
  writeConfigImages(stem);
  await writeManifestToFile(config, `${stem}.json`);
  await volViewPage.open(
    `?urls=[tmp/${stem}.json,tmp/${stem}.nrrd,tmp/${stem}.seg.nrrd]`
  );
  await volViewPage.waitForViews();
  await openAnnotationSegments();
  await waitForSegmentContent('Matched mask');
};

const labels = { rulerLabels: { Configured: { color: '#ff0000' } } };

describe('Segmentation configuration migration', () => {
  for (const key of ['segmentationSaveFormat', 'segmentGroupSaveFormat']) {
    it(`saves session masks as ${key} specifies and migrates label configuration`, async () => {
      await openConfigured({
        io: { [key]: 'mha', segmentationExtension: 'seg' },
        labels,
      });
      await waitForNamedSegments();
      expect(await segmentNames()).toContain('Configured');
      const filename = await volViewPage.saveSession();
      const path = join(TEMP_DIR, filename);
      await waitForDownload(path, SESSION_SAVE_TIMEOUT);
      const zip = await JSZip.loadAsync(readFileSync(path));
      const masks = Object.keys(zip.files).filter(
        (name) => name.startsWith('segmentations/') && !zip.files[name].dir
      );
      expect(masks.length).toBeGreaterThan(0);
      expect(masks.every((name) => name.endsWith('.mha'))).toBe(true);
    });
  }

  it('uses canonical segments when legacy labels are also supplied', async () => {
    await openConfigured({
      io: { segmentationExtension: 'seg' },
      labels,
      segments: { Canonical: { color: '#00ff00' } },
    });
    const names = await segmentNames();
    expect(names).toContain('Canonical');
    expect(names).not.toContain('Configured');
  });
});
