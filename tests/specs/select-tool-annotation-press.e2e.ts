import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { AnnotationUtils } from './annotationTestUtils';

const DRAG_DY = 40;
const TOLERANCE_PX = 3;

// The widget manager sets the hover cursor once its pick lands on an annotation
// and restores the default one once it lands on nothing.
const waitForViewCursor = (
  axialView: Locator,
  cursor: string,
  message: string
) => expect(axialView.locator('div.view'), message).toHaveCSS('cursor', cursor);

const getHandleCenters = (axialView: Locator) =>
  axialView.locator('svg circle').evaluateAll((circles) =>
    circles.map((circle) => ({
      x: Number(circle.getAttribute('cx')),
      y: Number(circle.getAttribute('cy')),
    }))
  );

// BoundingRectangle.vue draws this around the selected annotation
const waitForSelection = (axialView: Locator, message: string) =>
  expect(
    axialView.locator('svg rect[stroke="lightgray"]'),
    message
  ).toHaveCount(1);

const placeAnnotation = async (
  {
    volview,
    annotation,
  }: { volview: VolViewPage; annotation: AnnotationUtils },
  icon: string,
  points: Array<[number, number]>
) => {
  await volview.selectTool(icon);
  for (const [x, y] of points) {
    await annotation.clickAt(x, y);
  }
};

// Confirms the press landed on the annotation, then hovers empty space so the
// DOM reflects everything the press did before the handles are compared.
const settleAfterPress = async (
  annotation: AnnotationUtils,
  axialView: Locator,
  awayX: number,
  awayY: number
) => {
  await waitForSelection(axialView, 'Pressing the annotation should select it');
  await annotation.nudgeTo(awayX, awayY);
  await waitForViewCursor(
    axialView,
    'default',
    'Leaving the annotation should restore the default cursor'
  );
};

const expectHandlesUnmoved = (
  before: Array<{ x: number; y: number }>,
  after: Array<{ x: number; y: number }>
) => {
  expect(after.length).toBe(before.length);
  before.forEach((handle, index) => {
    expect(Math.abs(after[index].x - handle.x)).toBeLessThanOrEqual(
      TOLERANCE_PX
    );
    expect(Math.abs(after[index].y - handle.y)).toBeLessThanOrEqual(
      TOLERANCE_PX
    );
  });
};

const TOOL_CASES = [
  { tool: 'ruler', icon: 'mdi-ruler' },
  { tool: 'rectangle', icon: 'mdi-vector-square' },
];

// The select tool resolves its own pick on press. The annotation widgets read
// the widget manager's standing pick while handling that same press.
test.describe('Pressing an annotation with the select tool', () => {
  TOOL_CASES.forEach(({ tool, icon }) => {
    test(`drags the ${tool} handle without an application error`, async ({
      volview,
      annotation,
    }) => {
      const { axialView, centerX, centerY } = await annotation.setupTest();
      const handleX = Math.round(centerX - 60);
      const handleY = Math.round(centerY - 60);

      await placeAnnotation({ volview, annotation }, icon, [
        [handleX, handleY],
        [centerX + 60, centerY + 60],
      ]);
      await annotation.waitForCircleCount(
        axialView,
        2,
        `${tool} should have two handles`
      );
      const [before] = await getHandleCenters(axialView);

      await volview.selectTool('mdi-cursor-default');
      // vtk.js reports the first move after an idle period as StartMouseMove,
      // which the widget manager does not pick on, so nudge onto the handle.
      await annotation.nudgeTo(handleX, handleY);
      await waitForViewCursor(
        axialView,
        'pointer',
        'Hovering the handle should pick it'
      );
      await annotation.dragPointerTo(handleX, handleY + DRAG_DY);

      await expect
        .poll(
          async () => {
            const [after] = await getHandleCenters(axialView);
            return Math.abs(after.y - before.y - DRAG_DY) <= TOLERANCE_PX;
          },
          { message: `The ${tool} handle should follow the drag` }
        )
        .toBe(true);
      const [after] = await getHandleCenters(axialView);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  });

  test('keeps the ruler handles in place when its line is clicked', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    const midX = Math.round(centerX);
    const midY = Math.round(centerY);

    await placeAnnotation({ volview, annotation }, 'mdi-ruler', [
      [midX - 60, midY - 60],
      [midX + 60, midY + 60],
    ]);
    await annotation.waitForCircleCount(
      axialView,
      2,
      'Ruler should have two handles'
    );
    const before = await getHandleCenters(axialView);

    await volview.selectTool('mdi-cursor-default');
    await annotation.nudgeTo(midX, midY);
    await waitForViewCursor(
      axialView,
      'pointer',
      'Hovering the line should pick the ruler'
    );
    await annotation.pressAtPointer();
    await settleAfterPress(annotation, axialView, midX + 140, midY - 140);

    expectHandlesUnmoved(before, await getHandleCenters(axialView));
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  // The polygon moves its active handle on mouse move, so a drag is what
  // would expose an unintended grab of the edge.
  test('keeps the polygon handles in place when its edge is dragged', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    const midX = Math.round(centerX);
    const topY = Math.round(centerY - 80);

    await placeAnnotation({ volview, annotation }, 'mdi-pentagon-outline', [
      [midX - 80, topY],
      [midX + 80, topY],
      [midX, centerY + 80],
      [midX - 80, topY], // close
    ]);
    await annotation.waitForCircleCount(
      axialView,
      3,
      'Polygon should have three handles'
    );
    const before = await getHandleCenters(axialView);

    await volview.selectTool('mdi-cursor-default');
    await annotation.nudgeTo(midX, topY);
    await waitForViewCursor(
      axialView,
      'pointer',
      'Hovering the edge should pick the polygon'
    );
    await annotation.dragPointerTo(midX, topY + DRAG_DY);
    await settleAfterPress(annotation, axialView, midX + 140, topY - 60);

    expectHandlesUnmoved(before, await getHandleCenters(axialView));
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
