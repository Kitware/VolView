import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { clickAt, setupTest, waitForCircleCount } from './annotationTestUtils';

// BoundingRectangle.vue draws this around the selected annotation
const getSelectionRectCount = async (axialView: ChainablePromiseElement) => {
  const rects = await axialView.$$('svg rect[stroke="lightgray"]');
  return rects.length;
};

const waitForSelectionRectCount = (
  axialView: ChainablePromiseElement,
  expected: number,
  timeoutMsg: string
) =>
  browser.waitUntil(
    async () => (await getSelectionRectCount(axialView)) === expected,
    { timeout: 5000, timeoutMsg }
  );

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
const nudgeTo = (x: number, y: number) =>
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

const teleportTo = async (x: number, y: number) => {
  await browser.pause(IDLE_MS);
  await hoveringMouse()
    .move({ duration: INSTANT, x: Math.round(x), y: Math.round(y) })
    .perform(true);
};

const pressAtPointer = () => hoveringMouse().down().up().perform(true);

const placeRectangle = async (cx: number, cy: number, halfSize: number) => {
  await AppPage.selectTool('mdi-vector-square');
  await clickAt(cx - halfSize, cy - halfSize);
  await clickAt(cx + halfSize, cy + halfSize);
};

// Hovers the handle and presses until the annotation selects, which proves the
// widget manager resolved a pick there and left it as its standing selection.
const hoverAndSelect = async (
  axialView: ChainablePromiseElement,
  x: number,
  y: number
) =>
  browser.waitUntil(
    async () => {
      await nudgeTo(x, y);
      await pressAtPointer();
      return (await getSelectionRectCount(axialView)) === 1;
    },
    {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Pressing on the annotation handle should select it',
    }
  );

describe('Selection picks at the press position', () => {
  it('does not select an annotation the pointer left without a tracked move', async () => {
    const { axialView, centerX, centerY } = await setupTest();

    const handleX = centerX - 80;
    const handleY = centerY - 80;
    await placeRectangle(centerX, centerY, 80);
    await waitForCircleCount(axialView, 2, 'Rectangle should have two handles');

    await AppPage.selectTool('mdi-cursor-default');
    await hoverAndSelect(axialView, handleX, handleY);

    // Empty image area, well clear of both handles and the rectangle outline
    await teleportTo(centerX + 140, centerY - 140);
    await pressAtPointer();

    await waitForSelectionRectCount(
      axialView,
      0,
      'Pressing on empty space should deselect, not act on the pick left behind at the handle'
    );
  });

  // Control for the case above: same annotation, same press position, only the
  // move onto empty space is one the widget manager tracks. Deselecting here
  // shows the press does reach the view and that nothing is pickable there.
  it('deselects when the move onto empty space is tracked', async () => {
    const { axialView, centerX, centerY } = await setupTest();

    await placeRectangle(centerX, centerY, 80);
    await waitForCircleCount(axialView, 2, 'Rectangle should have two handles');

    await AppPage.selectTool('mdi-cursor-default');
    await hoverAndSelect(axialView, centerX - 80, centerY - 80);

    await nudgeTo(centerX + 140, centerY - 140);
    await pressAtPointer();

    await waitForSelectionRectCount(
      axialView,
      0,
      'Pressing on empty space should deselect the rectangle'
    );
  });
});
