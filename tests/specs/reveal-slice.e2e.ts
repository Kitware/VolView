import type { Page } from '@playwright/test';
import { CINE_US_DATASET, PROSTATEX_DATASET } from '../datasets';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';

const waitForToolEntry = (page: Page, iconClass: string) =>
  expect
    .poll(
      () =>
        page
          .locator(`[data-testid="segment-shape-row"] i.${iconClass}`)
          .count(),
      { message: `Tool entry with icon ${iconClass} not found` }
    )
    .toBeGreaterThanOrEqual(1);

const clickRevealSliceButton = async (page: Page) => {
  // The shape's own reveal, under its segment: the segment row carries one too.
  await page
    .locator(
      '[data-testid="segment-shape-row"] button[data-testid="reveal-shape-button"]'
    )
    .first()
    .click();
};

const getCanvasCenter = async (volview: VolViewPage) => {
  const box = await volview.views2D.first().locator('canvas').boundingBox();
  if (!box) throw new Error('The 2D view canvas is not on screen');
  return {
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
};

const clickAt = async (page: Page, x: number, y: number) => {
  await page.mouse.move(Math.round(x), Math.round(y));
  await page.mouse.down();
  await page.mouse.up();
};

const placeRulerAtCanvasCenter = async (page: Page, volview: VolViewPage) => {
  await page.locator('button span i[class~=mdi-ruler]').click();

  const { centerX, centerY } = await getCanvasCenter(volview);
  await clickAt(page, centerX - 40, centerY);
  await clickAt(page, centerX + 40, centerY);
};

// --- normal volume image ----------------------------------------------

const waitForSliceOverlay = (volview: VolViewPage) =>
  expect
    .poll(volview.getFirst2DSlice, { message: 'Slice overlay never appeared' })
    .not.toBeUndefined();

const waitForSlice = (volview: VolViewPage, expectedSlice1Indexed: number) =>
  expect
    .poll(volview.getFirst2DSlice, {
      message: `Expected view slice to reach ${expectedSlice1Indexed}`,
    })
    .toBe(expectedSlice1Indexed);

test.describe('Reveal Slice on a volume image', () => {
  test('ruler Reveal Slice jumps the view back to the placed slice', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);

    await volview.focusFirst2DView();
    await waitForSliceOverlay(volview);
    const placementSlice = await volview.getFirst2DSlice();
    expect(placementSlice).not.toBeUndefined();

    await placeRulerAtCanvasCenter(page, volview);

    // Advance to a different slice so reveal has somewhere to jump back to.
    await volview.advanceSliceAndWait();
    await volview.advanceSliceAndWait();
    const movedSlice = await volview.getFirst2DSlice();
    expect(movedSlice).not.toBe(placementSlice);

    await segmentation.openSegmentShapes();
    await waitForToolEntry(page, 'mdi-ruler');

    await clickRevealSliceButton(page);
    await waitForSlice(volview, placementSlice!);
  });
});

// --- cine ultrasound --------------------------------------------------

test.describe('Reveal Slice on cine ultrasound', () => {
  test('ruler Reveal Slice jumps to the cine frame the ruler was placed on', async ({
    page,
    volview,
    utils,
    cine,
    segmentation,
  }) => {
    await utils.openUrls([CINE_US_DATASET]);

    const playControls = page.locator('.play-controls').first();
    await expect(playControls).toBeVisible();
    await cine.waitForFrame(1);

    await volview.focusFirst2DView();

    // Cine images report dimensions [cols, rows, 1]; placing the tool past
    // frame 1 (slice index > 0) is what exercises the reveal-slice bug.
    await cine.advanceCineFrame();
    await cine.advanceCineFrame();
    const placementFrame = await cine.getCineFrame();
    expect(placementFrame).not.toBe(1);

    await placeRulerAtCanvasCenter(page, volview);

    // Sanity check: the committed ruler is visible on the frame it was placed.
    await expect
      .poll(cine.countCineRulerLines, {
        message: 'Expected the placed ruler line to render on the cine frame',
      })
      .toBeGreaterThanOrEqual(1);

    await cine.advanceCineFrame();
    await cine.advanceCineFrame();
    const movedFrame = await cine.getCineFrame();
    expect(movedFrame).not.toBe(placementFrame);

    // Off the placement frame: the committed ruler must not render. The
    // placing-tool stub has no points yet and so contributes no <line>.
    await expect
      .poll(cine.countCineRulerLines, {
        message:
          'Expected the placed ruler to be hidden on frames other than the placement frame',
      })
      .toBe(0);

    await segmentation.openSegmentShapes();
    await waitForToolEntry(page, 'mdi-ruler');

    await clickRevealSliceButton(page);
    await cine.waitForFrame(placementFrame!);

    await volview.focusFirst2DView();
    await cine.advanceCineFrame();
    await segmentation.revealSegment('Segment 1');
    await cine.waitForFrame(placementFrame!);
    await expect
      .poll(cine.countCineRulerLines, {
        message: 'Segment reveal should restore its cine annotation frame',
      })
      .toBeGreaterThanOrEqual(1);
  });
});
