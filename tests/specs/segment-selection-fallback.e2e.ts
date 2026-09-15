import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import AppPage from '../pageobjects/volview.page';
import { nudgeTo, pressAtPointer } from './annotationTestUtils';
import {
  openAnnotationSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';

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
async function openUnselectedSegmentsWithPaint() {
  const parent = new Uint8Array(SIZE ** 3).map((_, offset) => offset % 251);
  fs.writeFileSync(path.join(TEMP_DIR, `${STEM}-parent.nrrd`), nrrd(parent));
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
  fs.writeFileSync(
    path.join(TEMP_DIR, `${STEM}.volview.zip`),
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  await AppPage.open(`?urls=[tmp/${STEM}.volview.zip]`);
  await AppPage.waitForViews();
  await openAnnotationSegments();
  await waitForSegmentContent('First');
  await waitForSegmentContent('Second');
}

const selectedRow = () =>
  $('[data-testid="segment-list"] .item-row[aria-current="true"]');

describe('Selection with no segment chosen', () => {
  it('highlights the first row and erases from it', async () => {
    await openUnselectedSegmentsWithPaint();
    await expect(selectedRow()).toHaveAttribute('aria-label', 'First');

    const [view] = await AppPage.getViews2D();
    const canvas = view.$('canvas');
    const [location, size] = await Promise.all([
      canvas.getLocation(),
      canvas.getSize(),
    ]);
    const x = location.x + size.width / 2;
    const y = location.y + size.height / 2;

    const erase = $('button.mode-button*=Erase');
    await erase.waitForClickable();
    await erase.click();
    await expect($('button.mode-button.selected')).toHaveText('Erase');
    await nudgeTo(x, y);
    await pressAtPointer();

    await $('[data-testid="paint-eyedropper-button"]').click();
    await browser.waitUntil(async () =>
      String((await canvas.getCSSProperty('cursor')).value).startsWith('url(')
    );
    await nudgeTo(x, y);
    await pressAtPointer();

    await expect(selectedRow()).toHaveAttribute('aria-label', 'Second');
  });
});
