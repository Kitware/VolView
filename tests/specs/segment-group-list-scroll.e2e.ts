import { volViewPage } from '../pageobjects/volview.page';
import { openUrls } from './utils';
import { PROSTATEX_DATASET } from './configTestUtils';
import { addSegment, openAnnotationSegments } from './segmentationTestUtils';

const SEGMENT_COUNT = 20;

describe('Segment list', () => {
  it('lets the module panel scroll when segments overflow it', async () => {
    await openUrls([PROSTATEX_DATASET]);
    await openAnnotationSegments();

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      await addSegment();
    }

    const list = await volViewPage.segmentList;
    await list.waitForDisplayed();

    const segments = await list.$$('.v-chip .text-truncate');
    expect(segments.length).toEqual(SEGMENT_COUNT);

    const panel = await $('#module-container');
    const scrollHeight = Number(await panel.getProperty('scrollHeight'));
    const clientHeight = Number(await panel.getProperty('clientHeight'));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    const overflowY = await panel.getCSSProperty('overflow-y');
    expect(overflowY.value).toEqual('auto');
  });
});
