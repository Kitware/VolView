import * as fs from 'node:fs';
import * as path from 'node:path';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { projectRoot } from '../e2eTestUtils';
import { volViewPage } from '../pageobjects/volview.page';
import { openVolViewPage, writeManifestToFile } from './utils';
import {
  openAnnotationSegments,
  segmentNames,
  waitForSegmentContent,
} from './segmentationTestUtils';

const dimensions = 8;

const writeVolume = (
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
  fs.writeFileSync(
    path.join(TEMP_DIR, name),
    Buffer.concat([Buffer.from(header), voxels])
  );
};

const addAsSegmentation = async (name: string) => {
  await $('button[data-testid="module-tab-Data"]').click();
  const card = $(`.v-card:has([title="${name}"])`);
  await card.$('button.dataset-menu').click();
  const menuItem = $(
    `//*[contains(@class,"v-overlay--active")]//*[contains(@class,"v-list-item") and contains(normalize-space(.),"Add as segmentation")]`
  );
  await menuItem.$('.v-list-item__content').click();
  await card
    .$('[data-testid="segmentation-conversion-progress"]')
    .waitForDisplayed({ reverse: true });
};

describe('Importing overlapping files with the same Slicer segment name', function () {
  this.timeout(120_000);

  it('keeps both masks and gives their flat-list rows unique names', async () => {
    writeVolume('multi-import-parent.nrrd', (i, j, k) => i + j + k);
    writeVolume(
      'multi-import-left.seg.nrrd',
      (i, j, k) =>
        i >= 2 && i <= 4 && j >= 2 && j <= 5 && k >= 2 && k <= 5 ? 1 : 0,
      '1 0 0'
    );
    writeVolume(
      'multi-import-right.seg.nrrd',
      (i, j, k) =>
        i >= 3 && i <= 5 && j >= 2 && j <= 5 && k >= 2 && k <= 5 ? 1 : 0,
      '0 1 0'
    );
    await writeManifestToFile(
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
    await openVolViewPage('multiple-segmentation-import.json');

    await $('button[data-testid="module-tab-Data"]').click();
    await $('.v-card:has([title="multi-import-parent.nrrd"])').click();
    await addAsSegmentation('multi-import-left.seg.nrrd');
    await addAsSegmentation('multi-import-right.seg.nrrd');

    await openAnnotationSegments();
    await browser.waitUntil(
      async () => (await segmentNames()).join(',') === 'Tumor,Tumor (2)',
      { timeoutMsg: 'Expected both imported Tumor masks in the segment list' }
    );
    await waitForSegmentContent('Tumor');
    await waitForSegmentContent('Tumor (2)');
    expect(await segmentNames()).toEqual(['Tumor', 'Tumor (2)']);

    await volViewPage.clickSaveSegmentsButton();
    const notice = $('[data-testid="save-overlap-notice"]');
    await expect(notice).toBeDisplayed();
    expect(await notice.getText()).toBe(
      'Saving 2 files due to overlap, bundled into multi-import-parent.nrrd.zip.'
    );
    if (process.env.CAPTURE_SEGMENT_IMPORT_DEMO) {
      const demoDir = path.join(projectRoot(), '.tmp', 'demo');
      fs.mkdirSync(demoDir, { recursive: true });
      await browser.saveScreenshot(
        path.join(demoDir, 'multiple-segmentation-import.png')
      );
    }
  });
});
