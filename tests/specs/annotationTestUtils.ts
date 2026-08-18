import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';
import { openUrls } from './utils';

const pointerAt = (x: number, y: number) =>
  browser.action('pointer').move({ x: Math.round(x), y: Math.round(y) });

export const moveTo = (x: number, y: number) => pointerAt(x, y).perform();

export const clickAt = (x: number, y: number) =>
  pointerAt(x, y).down().up().perform();

// One input source held across action chains, so a press can land where the last
// hover left the pointer. Chains that keep it perform without releasing actions,
// as releasing resets the pointer to the viewport origin.
const HOVERING_MOUSE = 'hovering-mouse';
const hoveringMouse = () => browser.action('pointer', { id: HOVERING_MOUSE });

// vtk.js only picks the widget under the cursor on its MouseMove event, and its
// interactor reports the first pointer move after ~200ms of stillness as
// StartMouseMove, which picks nothing. Arriving from a nudge makes the move that
// lands on the target a MouseMove, so the pick runs.
const NUDGE_PX = 2;

const nudgeTo = (x: number, y: number) =>
  hoveringMouse()
    .move({ x: Math.round(x) + NUDGE_PX, y: Math.round(y) + NUDGE_PX })
    .move({ x: Math.round(x), y: Math.round(y) })
    .perform(true);

// vtk.js sets the view's cursor from the pick it just resolved: the hover cursor
// when it found a widget, the default one when it found nothing.
const HOVER_CURSOR = 'pointer';

const viewCursor = async (view: ChainablePromiseElement) => {
  const container = await view.$('div.view');
  const { value } = await container.getCSSProperty('cursor');
  return value;
};

/**
 * Moves onto (x, y) and waits for the view to show the hover cursor, which says
 * vtk.js resolved a pick and found a widget there. Leaves the pointer on the
 * annotation so pressAtPointer can act on that pick.
 */
export const hoverUntilPicked = (
  view: ChainablePromiseElement,
  x: number,
  y: number
) =>
  browser.waitUntil(
    async () => {
      await nudgeTo(x, y);
      return (await viewCursor(view)) === HOVER_CURSOR;
    },
    {
      timeout: 10000,
      interval: 200,
      timeoutMsg: `Hovering ${x},${y} should put the view in its hover cursor`,
    }
  );

// Pressing without moving keeps the pick hoverUntilPicked waited for: vtk.js
// drops it on every mouse move and only refills it a render pass later.
export const pressAtPointer = () => hoveringMouse().down().up().perform(true);

export const rightClickAt = (x: number, y: number) =>
  pointerAt(x, y).down({ button: 2 }).up({ button: 2 }).perform();

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
