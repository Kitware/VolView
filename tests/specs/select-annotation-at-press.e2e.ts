import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import {
  clickAt,
  nudgeTo,
  pressAtPointer,
  setupTest,
  waitForCircleCount,
} from './annotationTestUtils';
import { writeMetaImage } from './utils';

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

const setupSelectedRectangle = async (fileName?: string) => {
  const context = await setupTest(fileName);
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
  return { ...context, shape, bounds, before };
};

describe('Selection picks at the press position', () => {
  afterEach(async () => {
    // Selection can still update after another press handler throws.
    expect(await AppPage.getNotificationsCount()).toBe(0);
  });

  it('deselects after changing slices without moving the pointer', async () => {
    const { axialView, shape, bounds, before } = await setupSelectedRectangle(
      writeMetaImage('selection-at-press.mha')
    );

    await AppPage.advanceSliceAndWait();
    await expect(shape.parentElement()).toHaveStyle({ display: 'none' });
    await pressAtPointer();
    await browser.keys('ArrowUp');
    await expect(shape.parentElement()).not.toHaveStyle({ display: 'none' });

    await waitForSelectionRectCount(
      axialView,
      0,
      'Pressing on an empty slice should deselect the annotation on the previous slice'
    );
    expect(await bounds()).toEqual(before);
  });

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
    it(`adjusts a ${name} handle after switching back from paint`, async () => {
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
      await AppPage.activatePaint();
      await AppPage.selectTool(icon);
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
      const expected = [Number(start[0]) + 35, Number(start[1]) + 20];
      await browser.waitUntil(
        async () => {
          const coordinates = await Promise.all(
            ['cx', 'cy'].map((axis) => firstHandle.getAttribute(axis))
          );
          return coordinates.every(
            (coordinate, index) =>
              Math.abs(Number(coordinate) - expected[index]) < 0.5
          );
        },
        { timeoutMsg: `Expected the dragged handle at ${expected.join(', ')}` }
      );
    });
  }
});
