import { test, expect } from '../fixtures';

const STEM = 'clear-scene-segments';

test.describe('Clearing the scene', () => {
  test('drops every segment the config does not declare', async ({
    page,
    scratch,
    volview,
    utils,
    segmentation,
  }) => {
    const image = utils.writeMetaImage(`${STEM}.mha`);
    await utils.writeManifestToFile(
      { segments: { Tumor: { color: '#ff0000' } } },
      `${STEM}-config.json`
    );
    await volview.open(`?urls=[tmp/${STEM}-config.json,tmp/${image}]`);
    await volview.waitForViews();
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.addSegment();
    await segmentation.addSegment();
    expect(await segmentation.segmentNames()).toEqual([
      'Tumor',
      'Segment 1',
      'Segment 2',
    ]);

    await page.keyboard.press('Control+/');
    await expect
      .poll(async () => (await segmentation.segmentNames()).length)
      .toBe(0);
    await expect(segmentation.createSegmentRow()).toBeDisabled();

    await utils.openThroughDialog(scratch.path(image));
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    expect(await segmentation.segmentNames()).toEqual(['Tumor']);
    expect(await volview.getNotificationsCount()).toEqual(0);
  });
});
