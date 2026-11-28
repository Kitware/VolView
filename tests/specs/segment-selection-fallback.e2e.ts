import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText } from '../pageobjects/volview.page';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { SegmentationUtils } from './segmentationTestUtils';

const SIZE = 32;
const STEM = 'selection-fallback';

const nrrd = (data: Uint8Array) =>
  Buffer.concat([
    Buffer.from(
      `NRRD0005\ntype: unsigned char\ndimension: 3\nsizes: ${SIZE} ${SIZE} ${SIZE}\nspace: left-posterior-superior\nspace directions: (1,0,0) (0,1,0) (0,0,1)\nspace origin: (0,0,0)\nencoding: raw\n\n`
    ),
    data,
  ]);

const wholeImageMask = (id: string, segmentId: string, name: string) => ({
  id,
  segmentId,
  representations: {
    labelmap: {
      path: `${id}.nrrd`,
      name,
      extent: [0, SIZE - 1, 0, SIZE - 1, 0, SIZE - 1],
    },
  },
});

// Both segments cover every voxel and the session names no selection. The
// eyedropper answers with the first segment covering a voxel, so it tells
// whether an erase took that voxel from First.
async function openUnselectedSegmentsWithPaint({
  scratch,
  volview,
  segmentation,
}: {
  scratch: Scratch;
  volview: VolViewPage;
  segmentation: SegmentationUtils;
}) {
  const parent = new Uint8Array(SIZE ** 3).map((_, offset) => offset % 251);
  scratch.writeFile(`${STEM}-parent.nrrd`, nrrd(parent));
  const zip = new JSZip();
  const full = nrrd(new Uint8Array(SIZE ** 3).fill(1));
  zip.file('first-mask.nrrd', full);
  zip.file('second-mask.nrrd', full);
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${STEM}-parent.nrrd` }],
      segments: [
        { id: 'first', name: 'First', color: [255, 0, 0, 255] },
        { id: 'second', name: 'Second', color: [0, 0, 255, 255] },
      ],
      segmentations: [
        {
          id: 'segmentation',
          name: 'Segments',
          parentImage: '0',
          order: ['first-mask', 'second-mask'],
          masks: [
            wholeImageMask('first-mask', 'first', 'First'),
            wholeImageMask('second-mask', 'second', 'Second'),
          ],
        },
      ],
      tools: { current: 'Paint', paint: { brushSize: 8 } },
    })
  );
  scratch.writeFile(
    `${STEM}.volview.zip`,
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  await volview.open(`?urls=[tmp/${STEM}.volview.zip]`);
  await volview.waitForViews();
  await segmentation.openAnnotationSegments();
  await segmentation.waitForSegmentContent('First');
  await segmentation.waitForSegmentContent('Second');
}

const selectedRow = (page: Page) =>
  page.locator('[data-testid="segment-list"] .item-row[aria-current="true"]');

test.describe('Selection with no segment chosen', () => {
  test('highlights the first row and erases from it', async ({
    page,
    scratch,
    volview,
    annotation,
    segmentation,
  }) => {
    await openUnselectedSegmentsWithPaint({ scratch, volview, segmentation });
    await expect(selectedRow(page)).toHaveAttribute('aria-label', 'First');

    const view = volview.views2D.first();
    const canvas = view.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    const erase = page.locator('button.mode-button', {
      hasText: containsText('Erase'),
    });
    await erase.click();
    await expect(page.locator('button.mode-button.selected')).toHaveText(
      'Erase'
    );
    await annotation.nudgeTo(x, y);
    await annotation.pressAtPointer();

    await page.locator('[data-testid="paint-eyedropper-button"]').click();
    await expect
      .poll(() =>
        canvas.evaluate((element) =>
          getComputedStyle(element).cursor.startsWith('url(')
        )
      )
      .toBe(true);
    await annotation.nudgeTo(x, y);
    await annotation.pressAtPointer();

    await expect(selectedRow(page)).toHaveAttribute('aria-label', 'Second');
  });
});
