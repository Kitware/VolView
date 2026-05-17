import { Key } from 'webdriverio';
import { CINE_US_DATASET, PROSTATEX_DATASET } from './configTestUtils';
import { downloadFile, openUrls } from './utils';
import { volViewPage } from '../pageobjects/volview.page';

const openMeasurementsTab = async () => {
  const annotationsTab = await $(
    'button[data-testid="module-tab-Annotations"]'
  );
  await annotationsTab.click();

  const measurementsTab = await $('button.v-tab*=Measurements');
  await measurementsTab.waitForClickable();
  await measurementsTab.click();
};

const waitForToolEntry = async (iconClass: string) => {
  await browser.waitUntil(
    async () => {
      const entries = await $$(`.v-list-item i.${iconClass}.tool-icon`);
      return (await entries.length) >= 1;
    },
    { timeoutMsg: `Tool entry with icon ${iconClass} not found` }
  );
};

const clickRevealSliceButton = async () => {
  // The reveal-slice button is the v-btn wrapping the mdi-target icon
  // inside the measurement tool list entry.
  const button = await $('.v-list-item button .mdi-target');
  await button.waitForClickable();
  await button.click();
};

const getCanvasCenter = async () => {
  const views2D = await volViewPage.getViews2D();
  const view = views2D[0];
  const canvas = await view.$('canvas');
  const location = await canvas.getLocation();
  const size = await canvas.getSize();
  return {
    centerX: location.x + size.width / 2,
    centerY: location.y + size.height / 2,
  };
};

const clickAt = async (x: number, y: number) => {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
};

const placeRulerAtCanvasCenter = async () => {
  const rulerToolButton = await $('button span i[class~=mdi-ruler]');
  await rulerToolButton.click();

  const { centerX, centerY } = await getCanvasCenter();
  await clickAt(centerX - 40, centerY);
  await clickAt(centerX + 40, centerY);
};

// --- normal volume image ----------------------------------------------

const waitForSliceOverlay = async () => {
  await browser.waitUntil(
    async () => (await volViewPage.getFirst2DSlice()) !== null,
    { timeoutMsg: 'Slice overlay never appeared' }
  );
};

const waitForSlice = async (expectedSlice1Indexed: number) => {
  await browser.waitUntil(
    async () => {
      const slice = await volViewPage.getFirst2DSlice();
      return slice === expectedSlice1Indexed;
    },
    { timeoutMsg: `Expected view slice to reach ${expectedSlice1Indexed}` }
  );
};

describe('Reveal Slice on a volume image', () => {
  it('ruler Reveal Slice jumps the view back to the placed slice', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await openUrls([PROSTATEX_DATASET]);

    await volViewPage.focusFirst2DView();
    await waitForSliceOverlay();
    const placementSlice = await volViewPage.getFirst2DSlice();
    expect(placementSlice).not.toBeNull();

    await placeRulerAtCanvasCenter();

    // Advance to a different slice so reveal has somewhere to jump back to.
    await volViewPage.advanceSliceAndWait();
    await volViewPage.advanceSliceAndWait();
    const movedSlice = await volViewPage.getFirst2DSlice();
    expect(movedSlice).not.toBe(placementSlice);

    await openMeasurementsTab();
    await waitForToolEntry('mdi-ruler');

    await clickRevealSliceButton();
    await waitForSlice(placementSlice!);
  });
});

// --- cine ultrasound --------------------------------------------------

const FRAME_LABEL_SELECTOR = '.view-annotations .frame-label';

const getCineFrame = async () => {
  const frameLabel = await $(FRAME_LABEL_SELECTOR);
  const text = (await frameLabel.getText()).trim();
  const match = text.match(/^Frame:\s*(\d+)\s*\/\s*\d+/);
  return match ? parseInt(match[1], 10) : null;
};

const waitForFrame = async (expected: number) => {
  await browser.waitUntil(async () => (await getCineFrame()) === expected, {
    timeoutMsg: `Expected cine frame to reach ${expected}`,
  });
};

const advanceCineFrame = async () => {
  const before = await getCineFrame();
  await browser.keys([Key.ArrowUp]);
  await browser.waitUntil(
    async () => {
      const now = await getCineFrame();
      return now !== null && now !== before;
    },
    { timeoutMsg: 'Cine frame counter did not advance' }
  );
};

describe('Reveal Slice on cine ultrasound', () => {
  it('ruler Reveal Slice jumps to the cine frame the ruler was placed on', async () => {
    await openUrls([CINE_US_DATASET]);

    const playControls = $('.play-controls');
    await playControls.waitForDisplayed();
    await waitForFrame(1);

    await volViewPage.focusFirst2DView();

    // Cine images report dimensions [cols, rows, 1]; placing the tool past
    // frame 1 (slice index > 0) is what exercises the reveal-slice bug.
    await advanceCineFrame();
    await advanceCineFrame();
    const placementFrame = await getCineFrame();
    expect(placementFrame).not.toBe(1);

    await placeRulerAtCanvasCenter();

    await advanceCineFrame();
    await advanceCineFrame();
    const movedFrame = await getCineFrame();
    expect(movedFrame).not.toBe(placementFrame);

    await openMeasurementsTab();
    await waitForToolEntry('mdi-ruler');

    await clickRevealSliceButton();
    await waitForFrame(placementFrame!);
  });
});
