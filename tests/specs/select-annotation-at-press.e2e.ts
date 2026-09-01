import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import {
  clickAt,
  nudgeTo,
  pressAtPointer,
  setupTest,
  teleportTo,
  waitForCircleCount,
} from './annotationTestUtils';

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
