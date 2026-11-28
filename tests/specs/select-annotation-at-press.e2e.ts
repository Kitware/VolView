import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { AnnotationUtils } from './annotationTestUtils';

// BoundingRectangle.vue draws this around the selected annotation
const selectionRects = (axialView: Locator) =>
  axialView.locator('svg rect[stroke="lightgray"]');

const waitForSelectionRectCount = (
  axialView: Locator,
  expected: number,
  message: string
) => expect(selectionRects(axialView), message).toHaveCount(expected);

// Hovers the handle and presses until the annotation selects, which proves the
// widget manager resolved a pick there and left it as its standing selection.
const hoverAndSelect = (
  annotation: AnnotationUtils,
  axialView: Locator,
  x: number,
  y: number
) =>
  expect
    .poll(
      async () => {
        await annotation.nudgeTo(x, y);
        await annotation.pressAtPointer();
        return selectionRects(axialView).count();
      },
      {
        // Each attempt presses, so attempts stay half a second apart.
        intervals: [500],
        message: 'Pressing on the annotation handle should select it',
      }
    )
    .toBe(1);

const setupSelectedRectangle = async (
  {
    volview,
    annotation,
  }: { volview: VolViewPage; annotation: AnnotationUtils },
  fileName?: string
) => {
  const context = await annotation.setupTest(fileName);
  const { axialView, centerX, centerY } = context;
  await volview.selectTool('mdi-vector-square');
  await annotation.clickAt(centerX - 80, centerY - 80);
  await annotation.clickAt(centerX + 80, centerY + 80);
  await annotation.waitForCircleCount(
    axialView,
    2,
    'Rectangle should have two handles'
  );
  await volview.selectTool('mdi-cursor-default');

  const shape = axialView.locator('svg rect:not([stroke="lightgray"])').first();
  const bounds = () =>
    Promise.all(
      ['x', 'y', 'width', 'height'].map((name) => shape.getAttribute(name))
    );
  const before = await bounds();
  await hoverAndSelect(annotation, axialView, centerX - 80, centerY - 80);
  return { ...context, shape, bounds, before };
};

test.describe('Selection picks at the press position', () => {
  test.afterEach(async ({ volview }) => {
    // Selection can still update after another press handler throws.
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('deselects after changing slices without moving the pointer', async ({
    page,
    volview,
    utils,
    annotation,
  }) => {
    const { axialView, shape, bounds, before } = await setupSelectedRectangle(
      { volview, annotation },
      utils.writeMetaImage('selection-at-press.mha')
    );

    await volview.advanceSliceAndWait();
    await expect(shape.locator('..')).toHaveCSS('display', 'none');
    await annotation.pressAtPointer();
    await page.keyboard.press('ArrowUp');
    await expect(shape.locator('..')).not.toHaveCSS('display', 'none');

    await waitForSelectionRectCount(
      axialView,
      0,
      'Pressing on an empty slice should deselect the annotation on the previous slice'
    );
    expect(await bounds()).toEqual(before);
  });

  test('deselects when the move onto empty space is tracked', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY, bounds, before } =
      await setupSelectedRectangle({ volview, annotation });

    await annotation.nudgeTo(centerX + 140, centerY - 140);
    await annotation.pressAtPointer();

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
    test(`adjusts a ${name} handle after switching back from paint`, async ({
      page,
      volview,
      annotation,
    }) => {
      const { axialView, centerX, centerY } = await annotation.setupTest();
      const handleX = centerX - 80;
      const handleY = centerY - 80;
      await volview.selectTool(icon);
      await annotation.clickAt(handleX, handleY);
      await annotation.clickAt(centerX + 80, centerY + 80);
      await annotation.waitForCircleCount(
        axialView,
        2,
        'Placed annotation should have two handles'
      );
      await volview.activatePaint();
      await volview.selectTool(icon);
      const firstHandle = axialView.locator('svg circle').first();
      const start = await Promise.all(
        ['cx', 'cy'].map((axis) => firstHandle.getAttribute(axis))
      );
      await annotation.nudgeTo(handleX, handleY);
      await page.mouse.move(Math.round(handleX), Math.round(handleY));
      await page.mouse.down();
      await page.mouse.move(Math.round(handleX + 35), Math.round(handleY + 20));
      await page.mouse.up();
      await annotation.waitForCircleCount(
        axialView,
        2,
        'Dragging should keep the same annotation'
      );
      const expected = [Number(start[0]) + 35, Number(start[1]) + 20];
      await expect
        .poll(
          async () => {
            const coordinates = await Promise.all(
              ['cx', 'cy'].map((axis) => firstHandle.getAttribute(axis))
            );
            return coordinates.every(
              (coordinate, index) =>
                Math.abs(Number(coordinate) - expected[index]) < 0.5
            );
          },
          { message: `Expected the dragged handle at ${expected.join(', ')}` }
        )
        .toBe(true);
    });
  }
});
