import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from '../datasets';
import { openUrls, openVolViewPage } from './utils';

const pointerAt = (x: number, y: number) =>
  browser.action('pointer').move({ x: Math.round(x), y: Math.round(y) });

export const moveTo = (x: number, y: number) => pointerAt(x, y).perform();

export const clickAt = (x: number, y: number) =>
  pointerAt(x, y).down().up().perform();

export const rightClickAt = (x: number, y: number) =>
  pointerAt(x, y).down({ button: 2 }).up({ button: 2 }).perform();

// One input source held across action chains, so a press can land exactly where
// an earlier chain left the pointer. Chains that keep it perform without
// releasing actions, as releasing resets the pointer to the viewport origin.
const HOVERING_MOUSE = 'hovering-mouse';
const hoveringMouse = () => browser.action('pointer', { id: HOVERING_MOUSE });

// A zero-duration move avoids interpolating intermediate pointer positions.
const INSTANT = 0;
const NUDGE_PX = 2;

// Approach the target through two nearby positions while retaining the pointer
// for a subsequent press at the same coordinates.
export const nudgeTo = (x: number, y: number) =>
  hoveringMouse()
    .move({
      duration: INSTANT,
      x: Math.round(x) + NUDGE_PX,
      y: Math.round(y) + NUDGE_PX,
    })
    .move({ duration: INSTANT, x: Math.round(x), y: Math.round(y) })
    .perform(true);

export const pressAtPointer = () => hoveringMouse().down().up().perform(true);

export const rightPressAtPointer = () =>
  hoveringMouse().down({ button: 2 }).up({ button: 2 }).perform(true);

/**
 * Loads the minimal DICOM or a generated fixture and returns the axial view
 * with the center of its canvas in page coordinates.
 */
export const setupTest = async (fileName?: string) => {
  if (fileName) await openVolViewPage(fileName);
  else await openUrls([MINIMAL_DICOM]);

  const views2D = await AppPage.getViews2D();
  const axialView = views2D[0];
  const canvas = await axialView.$('canvas');
  const [location, size] = await Promise.all([
    canvas.getLocation(),
    canvas.getSize(),
  ]);

  return {
    axialView,
    centerX: location.x + size.width / 2,
    centerY: location.y + size.height / 2,
  };
};

export const drawSquare = async (cx: number, cy: number, half: number) => {
  await clickAt(cx - half, cy - half);
  await clickAt(cx + half, cy - half);
  await clickAt(cx + half, cy + half);
  await clickAt(cx - half, cy + half);
  await clickAt(cx - half, cy - half); // close
};

// Handles of placed annotations
export const getCircleCount = async (axialView: ChainablePromiseElement) => {
  const circles = await axialView.$$('svg circle');
  return circles.length;
};

export const waitForCircleCount = async (
  axialView: ChainablePromiseElement,
  expected: number,
  timeoutMsg: string
) => {
  await browser.waitUntil(
    async () => (await getCircleCount(axialView)) === expected,
    { timeout: 5000, timeoutMsg }
  );
};
