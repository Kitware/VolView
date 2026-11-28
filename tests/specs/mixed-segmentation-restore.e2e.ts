import { test, expect } from '../fixtures';
import { writeConfigImages } from './configurationImage';

test.describe('Restoring a labelmap without saved segment definitions', () => {
  test('matches labels on an unviewed image without inheriting definitions', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    const stem = 'mixed-segmentation-restore';
    utils.writeMetaImage(`${stem}-source.mha`, { size: 8 });
    writeConfigImages(stem);
    await utils.writeManifestToFile(
      {
        version: '8.0.0',
        dataSources: [
          { id: 0, type: 'uri', uri: `/tmp/${stem}-source.mha` },
          { id: 1, type: 'uri', uri: `/tmp/${stem}.nrrd` },
          { id: 2, type: 'uri', uri: `/tmp/${stem}.seg.nrrd` },
        ],
        datasets: [
          { id: 'source', dataSourceId: 0 },
          { id: 'target', dataSourceId: 1 },
        ],
        primarySelection: 'source',
        imageSegments: [
          {
            imageId: 'source',
            segments: [
              { id: 'matched', name: 'Matched mask', color: [255, 0, 0, 255] },
              { id: 'unused', name: 'Unused', color: [0, 255, 0, 255] },
            ],
          },
        ],
        segmentationArtifacts: [
          { id: 'mask', name: 'Mask', parentImage: 'target', dataSourceId: 2 },
        ],
      },
      `${stem}.json`
    );
    await volview.open(`?urls=[tmp/${stem}.json]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await expect(await segmentation.segmentRow('Unused')).toBeVisible();
    await expect(page.locator('[data-testid="segment-list"]')).toHaveAttribute(
      'aria-busy',
      'false'
    );

    await segmentation.clickImageCard(`${stem}.nrrd`);
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent('Matched mask');
    expect(await segmentation.segmentNames()).toEqual(['Matched mask']);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
