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

const setupSelectedRectangle = async () => {
  const context = await setupTest();
  const { axialView, centerX, centerY } = context;
  await AppPage.selectTool('mdi-vector-square');
  await clickAt(centerX - 80, centerY - 80);
  await clickAt(centerX + 80, centerY + 80);
  await waitForCircleCount(axialView, 2, 'Rectangle should have two handles');
  await AppPage.selectTool('mdi-cursor-default');

  const shape = axialView.$('svg rect:not([stroke="lightgray"])');
  const bounds = () =>
    Promise.all(
      ['x', 'y', 'width', 'height'].map((name) => shape.getAttribute(name))
    );
  const before = await bounds();
  await hoverAndSelect(axialView, centerX - 80, centerY - 80);
  return { ...context, bounds, before };
};

describe('Selection picks at the press position', () => {
  afterEach(async () => {
    // Selection can still update after another press handler throws.
    expect(await AppPage.getNotificationsCount()).toBe(0);
  });

  it('does not select an annotation the pointer left without a tracked move', async () => {
    const { axialView, centerX, centerY, bounds, before } =
      await setupSelectedRectangle();

    // Empty image area, well clear of both handles and the rectangle outline
    await teleportTo(centerX + 140, centerY - 140);
    await pressAtPointer();

    await waitForSelectionRectCount(
      axialView,
      0,
      'Pressing on empty space should deselect, not act on the pick left behind at the handle'
    );
    expect(await bounds()).toEqual(before);
  });

  // Control for the case above: same annotation, same press position, only the
  // move onto empty space is one the widget manager tracks. Deselecting here
  // shows the press does reach the view and that nothing is pickable there.
  it('deselects when the move onto empty space is tracked', async () => {
    const { axialView, centerX, centerY, bounds, before } =
      await setupSelectedRectangle();

    await nudgeTo(centerX + 140, centerY - 140);
    await pressAtPointer();

    await waitForSelectionRectCount(
      axialView,
      0,
      'Pressing on empty space should deselect the rectangle'
    );
    expect(await bounds()).toEqual(before);
  });

  for (const [name, icon] of [
    ['rectangle', 'mdi-vector-square'],
    ['ruler', 'mdi-ruler'],
  ]) {
    it(`adjusts a ${name} handle with its drawing tool active`, async () => {
      const { axialView, centerX, centerY } = await setupTest();
      const handleX = centerX - 80;
      const handleY = centerY - 80;
      await AppPage.selectTool(icon);
      await clickAt(handleX, handleY);
      await clickAt(centerX + 80, centerY + 80);
      await waitForCircleCount(
        axialView,
        2,
        'Placed annotation should have two handles'
      );
      const firstHandle = axialView.$('svg circle');
      const start = await Promise.all(
        ['cx', 'cy'].map((axis) => firstHandle.getAttribute(axis))
      );
      await nudgeTo(handleX, handleY);
      await browser
        .action('pointer')
        .move({ x: Math.round(handleX), y: Math.round(handleY) })
        .down()
        .move({
          x: Math.round(handleX + 35),
          y: Math.round(handleY + 20),
          duration: 400,
        })
        .up()
        .perform();
      await waitForCircleCount(
        axialView,
        2,
        'Dragging should keep the same annotation'
      );
      expect(Number(await firstHandle.getAttribute('cx'))).toBeCloseTo(
        Number(start[0]) + 35,
        0
      );
      expect(Number(await firstHandle.getAttribute('cy'))).toBeCloseTo(
        Number(start[1]) + 20,
        0
      );
    });
  }
});
