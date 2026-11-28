import { expect, type Page } from '@playwright/test';
import { createVolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { CINE_US_DATASET } from '../datasets';
import { createAnnotationUtils } from './annotationTestUtils';
import { createUtils } from './utils';

export const CINE_VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-cine-view"]';
export const FRAME_LABEL_SELECTOR = '.view-annotations .frame-label';

export const createCineUtils = (page: Page, scratch: Scratch) => {
  const annotation = createAnnotationUtils(page, scratch);
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);

  const getCineFrame = async () => {
    const text = (
      await page.locator(FRAME_LABEL_SELECTOR).first().innerText()
    ).trim();
    const match = text.match(/^Frame:\s*(\d+)\s*\/\s*\d+/);
    return match ? parseInt(match[1], 10) : null;
  };

  const waitForFrame = (expected: number) =>
    expect
      .poll(getCineFrame, {
        message: `Expected cine frame to reach ${expected}`,
      })
      .toBe(expected);

  const stepCineFrame = (key: string, label: string) => async () => {
    const before = await getCineFrame();
    await page.keyboard.press(key);
    await expect
      .poll(
        async () => {
          const now = await getCineFrame();
          return now !== null && now !== before;
        },
        { message: `Cine frame counter did not ${label}` }
      )
      .toBe(true);
  };

  const countCineRulerLines = () =>
    page.evaluate((selector) => {
      const view = document.querySelector(selector);
      return view ? view.querySelectorAll('svg line').length : -1;
    }, CINE_VIEW_SELECTOR);

  const getCineCanvasCenter = async () => {
    const box = await page
      .locator(CINE_VIEW_SELECTOR)
      .first()
      .locator('canvas')
      .first()
      .boundingBox();
    if (!box) throw new Error('The cine canvas is not on screen');
    return {
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
    };
  };

  const advanceCineFrame = stepCineFrame('ArrowUp', 'advance');

  /** Opens the cine sample and scrubs past frame 1, returning that frame. */
  const openCinePastFirstFrame = async () => {
    await utils.openUrls([CINE_US_DATASET]);
    await expect(page.locator('.play-controls').first()).toBeVisible();
    await waitForFrame(1);
    await volview.focusFirst2DView();
    await advanceCineFrame();
    await advanceCineFrame();
    const frame = (await getCineFrame())!;
    expect(frame).toBeGreaterThan(1);
    return frame;
  };

  return {
    getCineFrame,
    waitForFrame,
    advanceCineFrame,
    retreatCineFrame: stepCineFrame('ArrowDown', 'retreat'),
    openCinePastFirstFrame,
    countCineRulerLines,
    getCineCanvasCenter,
    clickAt: annotation.clickAt,
  };
};

export type CineUtils = ReturnType<typeof createCineUtils>;
