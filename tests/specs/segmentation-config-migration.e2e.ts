import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { writeConfigImages } from './configurationImage';
import {
  addSegment,
  openAnnotationSegments,
  segmentColor,
  segmentNames,
  waitForNamedSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  openThroughDialog,
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
  it('continues automatic colors when adding and extending a configuration', async () => {
    const stem = 'segmentation-config-colors';
    writeConfigImages(stem);
    await volViewPage.open(`?urls=[tmp/${stem}.nrrd]`);
    await volViewPage.waitForViews();
    await openAnnotationSegments();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(
      `${stem}.nrrd`
    );
    await addSegment();
    await addSegment();
    const colors = [
      await segmentColor('Segment 1'),
      await segmentColor('Segment 2'),
    ];
    const configPath = await writeManifestToFile(
      { segments: { Tumor: {}, Liver: {} } },
      `${stem}.json`
    );
    await openThroughDialog(configPath);
    colors.push(await segmentColor('Tumor'), await segmentColor('Liver'));
    expect(new Set(colors).size).toBe(4);

    const extendedPath = await writeManifestToFile(
      { segments: { Node: {}, Tumor: {}, Liver: {} } },
      `${stem}-extended.json`
    );
    await openThroughDialog(extendedPath);
    expect(colors).not.toContain(await segmentColor('Node'));
    expect(await segmentColor('Tumor')).toBe(colors[2]);
    expect(await segmentColor('Liver')).toBe(colors[3]);
  });

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
