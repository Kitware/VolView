import { MINIMAL_DICOM, ONE_CT_SLICE_DICOM } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import {
  addSegment,
  openAnnotationSegments,
  renameSegment,
  segmentColor,
  segmentGroupNames,
  segmentNames,
  selectSegment,
} from './segmentationTestUtils';

const volumeCards = () => $$('.volume-card');

const activeCardIndex = () =>
  volumeCards().findIndex(async (card) =>
    ((await card.getAttribute('class')) ?? '').includes('volume-card-active')
  );

// The module panel keeps every module mounted, so a volume card is only
// clickable while the Data module is the one on screen.
const showImage = async (index: number) => {
  await $('button[data-testid="module-tab-Data"]').click();
  const cards = await volumeCards();
  await cards[index].scrollIntoView();
  await cards[index].click();
  await browser.waitUntil(async () => (await activeCardIndex()) === index, {
    timeout: 30000,
    timeoutMsg: `Expected volume card ${index} to become the viewed image`,
  });

  await openAnnotationSegments();
  const views2D = await volViewPage.getViews2D();
  await volViewPage.waitForLoadingIndicator(views2D[0]);
};

const paintOnViewedImage = async () => {
  const views2D = await volViewPage.getViews2D();
  await volViewPage.paintStrokeOnView(views2D[0]);
};

// Every edit makes its own segment active, and the panel lists the active
// segment's group, so no group has to be picked by hand.
const expectSegments = async (expected: string[]) => {
  await browser.waitUntil(
    async () => {
      const names = await segmentNames();
      return (
        names.length === expected.length &&
        names.every((name, index) => name === expected[index])
      );
    },
    { timeoutMsg: `Expected the segment list to show ${expected.join(', ')}` }
  );
  expect(await segmentNames()).toEqual(expected);
};

describe('Segment identity across images', function () {
  this.timeout(240_000);

  it('clones the active segment on the first edit of another image, and nowhere else', async () => {
    await openUrls([ONE_CT_SLICE_DICOM, MINIMAL_DICOM]);
    await browser.waitUntil(async () => (await volumeCards().length) === 2, {
      timeout: 30000,
      timeoutMsg: 'Expected both volume cards to appear',
    });

    const first = await activeCardIndex();
    expect(first).toBeGreaterThanOrEqual(0);
    const second = first === 0 ? 1 : 0;

    // A named segment on the first image, then selected: selection is what
    // states the intent the other image inherits.
    await volViewPage.activatePaint();
    await paintOnViewedImage();
    await openAnnotationSegments();
    await expectSegments(['Segment 1']);
    await addSegment();
    await renameSegment('Segment 2', 'Tumor');
    await selectSegment('Segment 1');
    await selectSegment('Tumor');
    const tumorColor = await segmentColor('Tumor');

    // Viewing the other image is not an edit, so it gets nothing.
    await showImage(second);
    expect(await segmentGroupNames()).toEqual([]);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);

    // The first edit there clones the name and color into a segment of its own.
    await browser.waitUntil(
      async () => {
        await paintOnViewedImage();
        return (await segmentGroupNames()).length === 1;
      },
      {
        timeout: 30000,
        interval: 1000,
        timeoutMsg: 'Expected painting to give this image a segment group',
      }
    );
    await expectSegments(['Tumor']);
    expect(await segmentColor('Tumor')).toEqual(tumorColor);

    // Back on the first image the edit lands on the segment it already has.
    await showImage(first);
    await paintOnViewedImage();
    await expectSegments(['Segment 1', 'Tumor']);

    // The clone is its own segment, so renaming the source stays local.
    await renameSegment('Tumor', 'Tumor A');
    await expectSegments(['Segment 1', 'Tumor A']);

    await showImage(second);
    await paintOnViewedImage();
    await expectSegments(['Tumor']);
  });
});
