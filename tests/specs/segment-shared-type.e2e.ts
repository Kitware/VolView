import { MINIMAL_DICOM, ONE_CT_SLICE_DICOM } from './configTestUtils';
import { openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import {
  addSegment,
  openAnnotationSegments,
  renameSegment,
  segmentColor,
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

// The panel lists the shared registry, so the rows are the same on every
// image; what differs is which of them this image has a mask for.
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

  it('offers one type on every image and paints it into each', async () => {
    await openUrls([ONE_CT_SLICE_DICOM, MINIMAL_DICOM]);
    await browser.waitUntil(async () => (await volumeCards().length) === 2, {
      timeout: 30000,
      timeoutMsg: 'Expected both volume cards to appear',
    });

    const first = await activeCardIndex();
    expect(first).toBeGreaterThanOrEqual(0);
    const second = first === 0 ? 1 : 0;

    // A named type, painted on the first image.
    await volViewPage.activatePaint();
    await paintOnViewedImage();
    await openAnnotationSegments();
    await expectSegments(['Segment 1']);
    await addSegment();
    await renameSegment('Segment 2', 'Tumor');
    await selectSegment('Tumor');
    const tumorColor = await segmentColor('Tumor');

    // The registry is image-independent, so viewing the other image offers
    // exactly the same types, and creates nothing.
    await showImage(second);
    await expectSegments(['Segment 1', 'Tumor']);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);

    // Painting there writes into this image's own mask for the same type.
    await paintOnViewedImage();
    await expectSegments(['Segment 1', 'Tumor']);
    expect(await segmentColor('Tumor')).toEqual(tumorColor);

    // Renaming the type renames it everywhere, because it is one type.
    await renameSegment('Tumor', 'Tumor A');
    await expectSegments(['Segment 1', 'Tumor A']);

    await showImage(first);
    await expectSegments(['Segment 1', 'Tumor A']);
    await paintOnViewedImage();
    await expectSegments(['Segment 1', 'Tumor A']);
  });
});
