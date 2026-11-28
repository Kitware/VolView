import JSZip from 'jszip';
import { test, expect } from '../fixtures';
import type { Scratch } from '../scratch';

const SIZE = 16;
const STEM = 'restore-binds-names';
const CONFIGURED_COLOR = 'rgb(255, 0, 0)';

const nrrd = (data: Uint8Array) =>
  Buffer.concat([
    Buffer.from(
      `NRRD0005\ntype: unsigned char\ndimension: 3\nsizes: ${SIZE} ${SIZE} ${SIZE}\nspace: left-posterior-superior\nspace directions: (1,0,0) (0,1,0) (0,0,1)\nspace origin: (0,0,0)\nencoding: raw\n\n`
    ),
    data,
  ]);

const writeSession = async (scratch: Scratch) => {
  const zip = new JSZip();
  zip.file('tumor-mask.nrrd', nrrd(new Uint8Array(SIZE ** 3).fill(1)));
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${STEM}.nrrd` }],
      segments: [{ id: 'tumor', name: 'Tumor', color: [0, 0, 255, 255] }],
      segmentations: [
        {
          id: 'segmentation',
          name: 'Session',
          parentImage: '0',
          order: ['tumor-mask'],
          masks: [
            {
              id: 'tumor-mask',
              segmentId: 'tumor',
              representations: {
                labelmap: {
                  path: 'tumor-mask.nrrd',
                  name: 'Tumor',
                  extent: [0, SIZE - 1, 0, SIZE - 1, 0, SIZE - 1],
                },
              },
            },
          ],
        },
      ],
    })
  );
  return scratch.writeFile(
    `${STEM}.volview.zip`,
    await zip.generateAsync({ type: 'nodebuffer' })
  );
};

test.describe('Restoring a session beside a configured image', () => {
  test('writes the config onto a restored same-named segment and keeps each image its own', async ({
    page,
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    const parent = new Uint8Array(SIZE ** 3).map((_, offset) => offset % 251);
    scratch.writeFile(`${STEM}.nrrd`, nrrd(parent));
    await utils.writeManifestToFile(
      { segments: { Tumor: { color: '#ff0000' } } },
      `${STEM}-config.json`
    );
    await volview.open(`?urls=[tmp/${STEM}-config.json,tmp/${STEM}.nrrd]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    expect(await segmentation.segmentNames()).toEqual(['Tumor']);
    expect(await segmentation.segmentColor('Tumor')).toEqual(CONFIGURED_COLOR);

    await utils.openThroughDialog(await writeSession(scratch));

    await segmentation.waitForSegmentContent('Tumor');
    expect(await segmentation.segmentNames()).toEqual(['Tumor']);
    expect(await segmentation.segmentColor('Tumor')).toEqual(CONFIGURED_COLOR);
    await page.locator('button[data-testid="module-tab-Data"]').click();
    await utils.waitForModuleTransitions();
    const cards = page.locator('.image-list-card');
    await expect(cards).toHaveCount(2);
    await cards.nth(0).click();
    await segmentation.openAnnotationSegments();
    // Both images share a file name; only the configured one's Tumor is empty.
    await expect(
      page.locator(
        '[data-testid="segment-list"] [data-testid="reveal-segment-button"]'
      )
    ).toBeDisabled();
    expect(await segmentation.segmentNames()).toEqual(['Tumor']);
    expect(await segmentation.segmentColor('Tumor')).toEqual(CONFIGURED_COLOR);
    expect(await volview.getNotificationsCount()).toEqual(0);
  });
});
