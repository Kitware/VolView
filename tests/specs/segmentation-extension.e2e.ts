import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';
import {
  openAnnotationSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';

const writeImages = () => {
  const header = [
    'NRRD0005',
    'type: unsigned char',
    'dimension: 3',
    'sizes: 8 8 8',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ];
  const pixels = Array.from({ length: 512 }, (_, i) =>
    i % 8 > 2 ? 1 : 0
  ).join(' ');
  writeFileSync(
    join(TEMP_DIR, 'extension-case.nrrd'),
    `${header.join('\n')}\n\n${pixels}`
  );
  writeFileSync(
    join(TEMP_DIR, 'extension-case.seg.nrrd'),
    `${header.join('\n')}\nSegment0_LabelValue:=1\nSegment0_Name:=Matched mask\n\n${pixels}`
  );
};

const openWithIo = async (io: Record<string, string>) => {
  writeImages();
  const configName = 'segmentation-extension-config.json';
  await writeManifestToFile({ io }, configName);
  await volViewPage.open(
    `?urls=[tmp/${configName},tmp/extension-case.nrrd,tmp/extension-case.seg.nrrd]`
  );
  await volViewPage.waitForViews();
};

describe('Segmentation filename configuration', () => {
  for (const key of ['segmentationExtension', 'segmentGroupExtension']) {
    it(`associates mask content using ${key}`, async () => {
      await openWithIo({ [key]: 'seg' });
      await openAnnotationSegments();
      await waitForSegmentContent('Matched mask');
      if (key === 'segmentGroupExtension') {
        await volViewPage.notifications.click();
        await $('.message-center .v-expansion-panel-title').click();
        await expect($('.v-overlay--active')).toHaveText(
          expect.stringContaining(
            'io.segmentGroupExtension was migrated to io.segmentationExtension'
          )
        );
      } else {
        expect(await volViewPage.getNotificationsCount()).toBe(0);
      }
    });
  }

  it('keeps the mask as an ordinary image when matching is disabled', async () => {
    await openWithIo({ segmentGroupExtension: '' });
    await $('button[data-testid="module-tab-Data"]').click();
    const mask = $('.v-card:has([title="extension-case.seg.nrrd"])');
    await mask.waitForDisplayed();
    await mask.$('button.dataset-menu').click();
    await expect($('.v-overlay--active')).toHaveText(
      expect.stringContaining('Add as segmentation')
    );
  });

  it('reports conflicting old and new configuration names', async () => {
    await openWithIo({
      segmentationExtension: 'seg',
      segmentGroupExtension: 'mask',
    });
    await volViewPage.waitForNotification();
    await volViewPage.notifications.click();
    await $('.message-center .v-expansion-panel-title').click();
    await expect($('.v-overlay--active')).toHaveText(
      expect.stringContaining(
        'io.segmentGroupExtension conflicts with io.segmentationExtension'
      )
    );
  });
});
