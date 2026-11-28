import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import { writeConfigImages } from './configurationImage';
import type { SegmentationUtils } from './segmentationTestUtils';
import type { Utils } from './utils';

const openConfigured = async (
  {
    volview,
    utils,
    segmentation,
  }: { volview: VolViewPage; utils: Utils; segmentation: SegmentationUtils },
  config: unknown
) => {
  const stem = 'segmentation-config-case';
  writeConfigImages(stem);
  await utils.writeManifestToFile(config, `${stem}.json`);
  await volview.open(
    `?urls=[tmp/${stem}.json,tmp/${stem}.nrrd,tmp/${stem}.seg.nrrd]`
  );
  await volview.waitForViews();
  await segmentation.openAnnotationSegments();
  await segmentation.waitForSegmentContent('Matched mask');
};

const labels = { rulerLabels: { Configured: { color: '#ff0000' } } };

test.describe('Segmentation configuration migration', () => {
  test('continues automatic colors when adding and extending a configuration', async ({
    volview,
    utils,
    segmentation,
  }) => {
    const stem = 'segmentation-config-colors';
    writeConfigImages(stem);
    await volview.open(`?urls=[tmp/${stem}.nrrd]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await expect(segmentation.segmentImageName()).toHaveText(`${stem}.nrrd`);
    await segmentation.addSegment();
    await segmentation.addSegment();
    const colors = [
      await segmentation.segmentColor('Segment 1'),
      await segmentation.segmentColor('Segment 2'),
    ];
    const configPath = await utils.writeManifestToFile(
      { segments: { Tumor: {}, Liver: {} } },
      `${stem}.json`
    );
    await utils.openThroughDialog(configPath);
    colors.push(
      await segmentation.segmentColor('Tumor'),
      await segmentation.segmentColor('Liver')
    );
    expect(new Set(colors).size).toBe(4);

    const extendedPath = await utils.writeManifestToFile(
      { segments: { Node: {}, Tumor: {}, Liver: {} } },
      `${stem}-extended.json`
    );
    await utils.openThroughDialog(extendedPath);
    expect(colors).not.toContain(await segmentation.segmentColor('Node'));
    expect(await segmentation.segmentColor('Tumor')).toBe(colors[2]);
    expect(await segmentation.segmentColor('Liver')).toBe(colors[3]);
  });

  for (const key of ['segmentationSaveFormat', 'segmentGroupSaveFormat']) {
    test(`saves session masks as ${key} specifies and migrates label configuration`, async ({
      scratch,
      volview,
      utils,
      segmentation,
    }) => {
      await openConfigured(
        { volview, utils, segmentation },
        {
          io: { [key]: 'mha', segmentationExtension: 'seg' },
          labels,
        }
      );
      await segmentation.waitForNamedSegments();
      expect(await segmentation.segmentNames()).toContain('Configured');
      const filename = await volview.saveSession();
      const zip = await JSZip.loadAsync(readFileSync(scratch.path(filename)));
      const masks = Object.keys(zip.files).filter(
        (name) => name.startsWith('segmentations/') && !zip.files[name].dir
      );
      expect(masks.length).toBeGreaterThan(0);
      expect(masks.every((name) => name.endsWith('.mha'))).toBe(true);
    });
  }

  test('uses canonical segments when legacy labels are also supplied', async ({
    volview,
    utils,
    segmentation,
  }) => {
    await openConfigured(
      { volview, utils, segmentation },
      {
        io: { segmentationExtension: 'seg' },
        labels,
        segments: { Canonical: { color: '#00ff00' } },
      }
    );
    const names = await segmentation.segmentNames();
    expect(names).toContain('Canonical');
    expect(names).not.toContain('Configured');
  });
});
