import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { PROSTATE_SEGMENT_GROUP } from '../datasets';
import { writeConfigImages } from './configurationImage';
import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';
import {
  openAnnotationSegments,
  segmentNames,
  waitForNamedSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';

const openWithIo = async (io?: Record<string, string>, extension = 'seg') => {
  writeConfigImages('extension-case');
  const maskName = `extension-case.${extension}.nrrd`;
  if (extension !== 'seg')
    renameSync(
      join(TEMP_DIR, 'extension-case.seg.nrrd'),
      join(TEMP_DIR, maskName)
    );
  const urls = ['tmp/extension-case.nrrd', `tmp/${maskName}`];
  if (io) {
    const configName = 'segmentation-extension-config.json';
    await writeManifestToFile({ io }, configName);
    urls.unshift(`tmp/${configName}`);
  } else {
    const lookalikeName = 'extension-case2.seg.nrrd';
    writeFileSync(
      join(TEMP_DIR, lookalikeName),
      readFileSync(join(TEMP_DIR, maskName), 'utf8').replace(
        'Segment0_Name:=Matched mask',
        'Segment0_Name:=Unrelated mask'
      )
    );
    urls.push(`tmp/${lookalikeName}`);
  }
  await volViewPage.open(`?urls=[${urls.join(',')}]`);
  await volViewPage.waitForViews();
};

describe('Segmentation filename configuration', () => {
  it('associates default NRRD and compressed NIfTI masks without configuration', async () => {
    await openWithIo();
    await openAnnotationSegments();
    await waitForSegmentContent('Matched mask');
    expect(await segmentNames()).toEqual(['Matched mask']);
    expect(await volViewPage.getNotificationsCount()).toBe(0);

    const niftiBase = 'nifti-base.nii.gz';
    const niftiMask = 'nifti-base.seg.nii.gz';
    for (const name of [niftiBase, niftiMask])
      copyFileSync(
        join(TEMP_DIR, PROSTATE_SEGMENT_GROUP.name),
        join(TEMP_DIR, name)
      );
    await volViewPage.open(`?urls=[tmp/${niftiBase},tmp/${niftiMask}]`);
    await volViewPage.waitForViews();
    await expect(
      $('.image-list-card:has([title="' + niftiBase + '"])')
    ).toHaveElementClass('image-list-card-active');
    await openAnnotationSegments();
    await waitForNamedSegments();
    await waitForSegmentContent((await segmentNames())[0]);
    expect(await segmentNames()).toHaveLength(10);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  for (const key of ['segmentationExtension', 'segmentGroupExtension']) {
    it(`associates an overridden mask extension using ${key}`, async () => {
      await openWithIo({ [key]: 'mask' }, 'mask');
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
    await openWithIo({ segmentationExtension: '' });
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
