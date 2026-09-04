import { volViewPage } from '../pageobjects/volview.page';
import { openUrls } from './utils';
import { PROSTATEX_DATASET } from './configTestUtils';

// Six 48px rows overflow the list's 240px cap.
const GROUP_COUNT = 6;

describe('Segment group list', () => {
  it('lets overflowing segment groups scroll', async () => {
    await openUrls([PROSTATEX_DATASET]);

    for (let i = 0; i < GROUP_COUNT; i++) {
      await volViewPage.createSegmentGroup(`Group ${i + 1}`);
    }

    const list = await volViewPage.segmentGroupList;
    await list.waitForDisplayed();

    const rows = await list.$$('.v-list-item');
    expect(rows.length).toEqual(GROUP_COUNT);

    const scrollHeight = Number(await list.getProperty('scrollHeight'));
    const clientHeight = Number(await list.getProperty('clientHeight'));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    const overflowY = await list.getCSSProperty('overflow-y');
    expect(overflowY.value).toEqual('auto');
  });
});
