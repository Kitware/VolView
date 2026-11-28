import { expect, type Locator, type Page } from '@playwright/test';
import { createVolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { MINIMAL_DICOM } from '../datasets';
import { createUtils } from './utils';

// Each page.mouse.move emits exactly one pointermove, as the WebdriverIO
// actions this replaces did, so coordinates and move counts carry over 1:1.
const NUDGE_PX = 2;

export const createAnnotationUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);
  const { mouse } = page;

  const moveTo = (x: number, y: number) =>
    mouse.move(Math.round(x), Math.round(y));

  const clickAt = (x: number, y: number) =>
    mouse.click(Math.round(x), Math.round(y));

  const rightClickAt = (x: number, y: number) =>
    mouse.click(Math.round(x), Math.round(y), { button: 'right' });

  // Approach the target through a nearby position, leaving the pointer there
  // for a later press at the same coordinates.
  const nudgeTo = async (x: number, y: number) => {
    await mouse.move(Math.round(x) + NUDGE_PX, Math.round(y) + NUDGE_PX);
    await mouse.move(Math.round(x), Math.round(y));
  };

  const pressAtPointer = async () => {
    await mouse.down();
    await mouse.up();
  };

  const dragPointerTo = async (x: number, y: number) => {
    await mouse.down();
    await mouse.move(Math.round(x), Math.round(y));
    await mouse.up();
  };

  const rightPressAtPointer = async () => {
    await mouse.down({ button: 'right' });
    await mouse.up({ button: 'right' });
  };

  /**
   * Loads the minimal DICOM or a generated fixture and returns the axial view
   * with the center of its canvas in page coordinates.
   */
  const setupTest = async (fileName?: string) => {
    if (fileName) await utils.openVolViewPage(fileName);
    else await utils.openUrls([MINIMAL_DICOM]);

    const axialView = volview.views2D.first();
    const box = await axialView.locator('canvas').boundingBox();
    if (!box) throw new Error('The axial view has no canvas on screen');
    return {
      axialView,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2,
    };
  };

  /** Drags from the view's canvas center through offsets from that center. */
  const dragFromViewCenter = async (
    view: Locator,
    offsets: ReadonlyArray<readonly [number, number]>
  ) => {
    const box = await view.locator('canvas').boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await moveTo(centerX, centerY);
    await mouse.down();
    for (const [dx, dy] of offsets) await moveTo(centerX + dx, centerY + dy);
    await mouse.up();
    return { centerX, centerY };
  };

  const drawSquare = async (cx: number, cy: number, half: number) => {
    await clickAt(cx - half, cy - half);
    await clickAt(cx + half, cy - half);
    await clickAt(cx + half, cy + half);
    await clickAt(cx - half, cy + half);
    await clickAt(cx - half, cy - half); // close
  };

  // Handles of placed annotations
  const getCircleCount = (axialView: Locator) =>
    axialView.locator('svg circle').count();

  const waitForCircleCount = (
    axialView: Locator,
    expected: number,
    timeoutMsg: string
  ) =>
    expect(axialView.locator('svg circle'), timeoutMsg).toHaveCount(expected);

  return {
    moveTo,
    clickAt,
    rightClickAt,
    nudgeTo,
    pressAtPointer,
    dragPointerTo,
    rightPressAtPointer,
    setupTest,
    dragFromViewCenter,
    drawSquare,
    getCircleCount,
    waitForCircleCount,
  };
};

export type AnnotationUtils = ReturnType<typeof createAnnotationUtils>;
