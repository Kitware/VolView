import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';
import { openUrls } from './utils';

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

// A move with a duration is interpolated into a stream of pointer moves. A
// zero duration dispatches exactly one, which is what teleportTo relies on.
const INSTANT = 0;
const NUDGE_PX = 2;

// Two moves in one chain, so the one landing on (x, y) is never the first move
// after an idle period, which vtk.js reports as StartMouseMove and the widget
// manager ignores. The pick therefore runs at (x, y).
export const nudgeTo = (x: number, y: number) =>
  hoveringMouse()
    .move({
      duration: INSTANT,
      x: Math.round(x) + NUDGE_PX,
      y: Math.round(y) + NUDGE_PX,
    })
    .move({ duration: INSTANT, x: Math.round(x), y: Math.round(y) })
    .perform(true);

// vtk.js reports the first pointer move after ~200ms of stillness as
// StartMouseMove, which the widget manager does not subscribe to. A single move
// after that idle therefore relocates the pointer while leaving the widget
// manager's pick standing at the old position.
const IDLE_MS = 400;

export const teleportTo = async (x: number, y: number) => {
  await browser.pause(IDLE_MS);
  await hoveringMouse()
    .move({ duration: INSTANT, x: Math.round(x), y: Math.round(y) })
    .perform(true);
};

export const pressAtPointer = () => hoveringMouse().down().up().perform(true);

export const rightPressAtPointer = () =>
  hoveringMouse().down({ button: 2 }).up({ button: 2 }).perform(true);

/**
 * Loads the minimal DICOM and returns the axial view with the center of its
 * canvas in page coordinates.
 */
export const setupTest = async () => {
  await openUrls([MINIMAL_DICOM]);

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
