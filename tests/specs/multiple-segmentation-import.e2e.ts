import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { projectRoot } from '../e2eTestUtils';
import type { Scratch } from '../scratch';
import type { Utils } from './utils';

const dimensions = 8;

const writeVolume = (
  scratch: Scratch,
  name: string,
  voxelAt: (i: number, j: number, k: number) => number,
  segmentColor?: string
) => {
  const segmentFields = segmentColor
    ? `Segment0_LabelValue:=1\nSegment0_Name:=Tumor\nSegment0_Color:=${segmentColor}\n`
    : '';
  const header =
    'NRRD0005\ntype: unsigned char\ndimension: 3\n' +
    'space: left-posterior-superior\nsizes: 8 8 8\n' +
    'space directions: (1,0,0) (0,1,0) (0,0,1)\n' +
    `space origin: (0,0,0)\n${segmentFields}encoding: raw\n\n`;
  const voxels = Buffer.from(
    Array.from({ length: dimensions ** 3 }, (_, index) => {
      const i = index % dimensions;
      const j = Math.floor(index / dimensions) % dimensions;
      const k = Math.floor(index / dimensions ** 2);
      return voxelAt(i, j, k);
    })
  );
  scratch.writeFile(name, Buffer.concat([Buffer.from(header), voxels]));
};

const addAsSegmentation = async (
  { page, utils }: { page: Page; utils: Utils },
  name: string
) => {
  await page.locator('button[data-testid="module-tab-Data"]').click();
  const card = page.locator(`.v-card:has([title="${name}"])`);
  await card.locator('button.dataset-menu').click();
  const menuItem = utils.overlayOption('Add as segmentation');
  await expect(menuItem).toBeVisible();
  await menuItem.click();
  await expect(
    card.locator('[data-testid="segmentation-conversion-progress"]')
  ).toBeHidden();
};

test.describe('Importing overlapping files with the same Slicer segment name', () => {
  test('keeps both masks and gives their flat-list rows unique names', async ({
    page,
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    writeVolume(scratch, 'multi-import-parent.nrrd', (i, j, k) => i + j + k);
    writeVolume(
      scratch,
      'multi-import-left.seg.nrrd',
      (i, j, k) =>
        i >= 2 && i <= 4 && j >= 2 && j <= 5 && k >= 2 && k <= 5 ? 1 : 0,
      '1 0 0'
    );
    writeVolume(
      scratch,
      'multi-import-right.seg.nrrd',
      (i, j, k) =>
        i >= 3 && i <= 5 && j >= 2 && j <= 5 && k >= 2 && k <= 5 ? 1 : 0,
      '0 1 0'
    );
    await utils.writeManifestToFile(
      {
        resources: [
          {
            url: '/tmp/multi-import-parent.nrrd',
            name: 'multi-import-parent.nrrd',
          },
          {
            url: '/tmp/multi-import-left.seg.nrrd',
            name: 'multi-import-left.seg.nrrd',
          },
          {
            url: '/tmp/multi-import-right.seg.nrrd',
            name: 'multi-import-right.seg.nrrd',
          },
        ],
      },
      'multiple-segmentation-import.json'
    );
    await utils.openVolViewPage('multiple-segmentation-import.json');

    await page.locator('button[data-testid="module-tab-Data"]').click();
    await page
      .locator('.v-card:has([title="multi-import-parent.nrrd"])')
      .click();
    await addAsSegmentation({ page, utils }, 'multi-import-left.seg.nrrd');
    await addAsSegmentation({ page, utils }, 'multi-import-right.seg.nrrd');

    await segmentation.openAnnotationSegments();
    await expect
      .poll(async () => (await segmentation.segmentNames()).join(','), {
        message: 'Expected both imported Tumor masks in the segment list',
      })
      .toBe('Tumor,Tumor (2)');
    await segmentation.waitForSegmentContent('Tumor');
    await segmentation.waitForSegmentContent('Tumor (2)');
    expect(await segmentation.segmentNames()).toEqual(['Tumor', 'Tumor (2)']);

    await volview.clickSaveSegmentsButton();
    const notice = page.locator('[data-testid="save-overlap-notice"]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(
      'Saving 2 files due to overlap, bundled into multi-import-parent.zip.'
    );
    if (process.env.CAPTURE_SEGMENT_IMPORT_DEMO) {
      const demoDir = path.join(projectRoot(), '.tmp', 'demo');
      fs.mkdirSync(demoDir, { recursive: true });
      await page.screenshot({
        path: path.join(demoDir, 'multiple-segmentation-import.png'),
      });
    }
  });
});
