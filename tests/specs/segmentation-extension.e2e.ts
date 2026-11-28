import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { test, expect } from '../fixtures';
import { PROSTATE_SEGMENT_GROUP } from '../datasets';
import { writeConfigImages } from './configurationImage';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { Utils } from './utils';

const openWithIo = async (
  {
    scratch,
    volview,
    utils,
  }: { scratch: Scratch; volview: VolViewPage; utils: Utils },
  io?: Record<string, string>,
  extension = 'seg'
) => {
  writeConfigImages('extension-case');
  const maskName = `extension-case.${extension}.nrrd`;
  if (extension !== 'seg')
    renameSync(scratch.path('extension-case.seg.nrrd'), scratch.path(maskName));
  const urls = ['tmp/extension-case.nrrd', `tmp/${maskName}`];
  if (io) {
    const configName = 'segmentation-extension-config.json';
    await utils.writeManifestToFile({ io }, configName);
    urls.unshift(`tmp/${configName}`);
  } else {
    const lookalikeName = 'extension-case2.seg.nrrd';
    writeFileSync(
      scratch.path(lookalikeName),
      readFileSync(scratch.path(maskName), 'utf8').replace(
        'Segment0_Name:=Matched mask',
        'Segment0_Name:=Unrelated mask'
      )
    );
    urls.push(`tmp/${lookalikeName}`);
  }
  await volview.open(`?urls=[${urls.join(',')}]`);
  await volview.waitForViews();
};

test.describe('Segmentation filename configuration', () => {
  test('associates default NRRD and compressed NIfTI masks without configuration', async ({
    page,
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    await openWithIo({ scratch, volview, utils });
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent('Matched mask');
    expect(await segmentation.segmentNames()).toEqual(['Matched mask']);
    expect(await volview.getNotificationsCount()).toBe(0);

    const niftiBase = 'nifti-base.nii.gz';
    const niftiMask = 'nifti-base.seg.nii.gz';
    for (const name of [niftiBase, niftiMask])
      copyFileSync(
        scratch.path(PROSTATE_SEGMENT_GROUP.name),
        scratch.path(name)
      );
    await volview.open(`?urls=[tmp/${niftiBase},tmp/${niftiMask}]`);
    await volview.waitForViews();
    await expect(
      page.locator('.image-list-card:has([title="' + niftiBase + '"])')
    ).toHaveClass(/image-list-card-active/);
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.waitForSegmentContent(
      (await segmentation.segmentNames())[0]
    );
    expect(await segmentation.segmentNames()).toHaveLength(10);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  for (const key of ['segmentationExtension', 'segmentGroupExtension']) {
    test(`associates an overridden mask extension using ${key}`, async ({
      page,
      scratch,
      volview,
      utils,
      segmentation,
    }) => {
      await openWithIo({ scratch, volview, utils }, { [key]: 'mask' }, 'mask');
      await segmentation.openAnnotationSegments();
      await segmentation.waitForSegmentContent('Matched mask');
      if (key === 'segmentGroupExtension') {
        await volview.notifications.click();
        await page.locator('.message-center .v-expansion-panel-title').click();
        await expect(page.locator('.v-overlay--active')).toContainText(
          'io.segmentGroupExtension was migrated to io.segmentationExtension'
        );
      } else {
        expect(await volview.getNotificationsCount()).toBe(0);
      }
    });
  }

  test('keeps the mask as an ordinary image when matching is disabled', async ({
    page,
    scratch,
    volview,
    utils,
  }) => {
    await openWithIo(
      { scratch, volview, utils },
      { segmentationExtension: '' }
    );
    await page.locator('button[data-testid="module-tab-Data"]').click();
    const mask = page.locator('.v-card:has([title="extension-case.seg.nrrd"])');
    await expect(mask).toBeVisible();
    await mask.locator('button.dataset-menu').click();
    await expect(page.locator('.v-overlay--active')).toContainText(
      'Add as segmentation'
    );
  });

  test('reports conflicting old and new configuration names', async ({
    page,
    scratch,
    volview,
    utils,
  }) => {
    await openWithIo(
      { scratch, volview, utils },
      {
        segmentationExtension: 'seg',
        segmentGroupExtension: 'mask',
      }
    );
    await volview.waitForNotification();
    await volview.notifications.click();
    await page.locator('.message-center .v-expansion-panel-title').click();
    await expect(page.locator('.v-overlay--active')).toContainText(
      'io.segmentGroupExtension conflicts with io.segmentationExtension'
    );
  });
});
