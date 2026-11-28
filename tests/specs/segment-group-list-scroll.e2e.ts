import { test, expect } from '../fixtures';
import { PROSTATEX_DATASET } from '../datasets';

const SEGMENT_COUNT = 20;

test.describe('Segment list', () => {
  test('lets the module panel scroll when segments overflow it', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);
    await segmentation.openAnnotationSegments();

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      await segmentation.addSegment();
    }

    const list = volview.segmentList;
    await expect(list).toBeVisible();

    await expect(list.locator('.item-row .v-list-item-title')).toHaveCount(
      SEGMENT_COUNT
    );

    const panel = page.locator('#module-container');
    const { scrollHeight, clientHeight } = await panel.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    const overflowY = await panel.evaluate(
      (element) => getComputedStyle(element).overflowY
    );
    expect(overflowY).toEqual('auto');
  });
});
