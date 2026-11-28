import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { AnnotationUtils } from './annotationTestUtils';

// BoundingRectangle.vue draws this around the selected annotation
const getSelectionRectCount = (axialView: Locator) =>
  axialView.locator('svg rect[stroke="lightgray"]').count();

const clickToSelect = async (
  {
    volview,
    annotation,
  }: { volview: VolViewPage; annotation: AnnotationUtils },
  axialView: Locator,
  x: number,
  y: number
) => {
  await volview.selectTool('mdi-cursor-default');
  // The widget manager resolves what is under the cursor from a render pass
  // driven by mouse move, so hover first and retry until the click picks it up.
  await annotation.moveTo(x, y);
  await expect
    .poll(
      async () => {
        await annotation.clickAt(x, y);
        return getSelectionRectCount(axialView);
      },
      {
        // Each attempt presses, so attempts stay half a second apart.
        intervals: [500],
        message: 'Clicking the annotation should draw a selection rectangle',
      }
    )
    .toBe(1);
};

const pressDelete = (page: Page) => page.keyboard.press('Delete');

const placeRectangle = async (
  {
    volview,
    annotation,
  }: { volview: VolViewPage; annotation: AnnotationUtils },
  cx: number,
  cy: number,
  halfSize: number
) => {
  await volview.selectTool('mdi-vector-square');
  await annotation.clickAt(cx - halfSize, cy - halfSize);
  await annotation.clickAt(cx + halfSize, cy + halfSize);
};

const TOOL_CASES = [
  {
    tool: 'ruler',
    icon: 'mdi-ruler',
    points: [
      [-60, -60],
      [60, 60],
    ],
    handles: 2,
  },
  {
    tool: 'rectangle',
    icon: 'mdi-vector-square',
    points: [
      [-80, -80],
      [80, 80],
    ],
    handles: 2,
  },
  {
    tool: 'polygon',
    icon: 'mdi-pentagon-outline',
    points: [
      [-80, -80],
      [80, -80],
      [80, 80],
      [-80, -80], // close
    ],
    handles: 3,
  },
];

test.describe('Delete key on a selected annotation', () => {
  TOOL_CASES.forEach(({ tool, icon, points, handles }) => {
    test(`deletes a selected ${tool}`, async ({
      page,
      volview,
      annotation,
    }) => {
      const { axialView, centerX, centerY } = await annotation.setupTest();

      await volview.selectTool(icon);
      for (const [dx, dy] of points) {
        await annotation.clickAt(centerX + dx, centerY + dy);
      }
      await annotation.waitForCircleCount(
        axialView,
        handles,
        `${tool} should have ${handles} handles`
      );

      const [firstX, firstY] = points[0];
      await clickToSelect(
        { volview, annotation },
        axialView,
        centerX + firstX,
        centerY + firstY
      );
      await pressDelete(page);

      await annotation.waitForCircleCount(
        axialView,
        0,
        `Delete should remove the ${tool}`
      );
      expect(await getSelectionRectCount(axialView)).toBe(0);
    });
  });

  // Working the annotations panel leaves focus on the control that was clicked,
  // which must not swallow the delete key
  test('deletes a selected annotation while the panel holds focus', async ({
    page,
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();

    await placeRectangle({ volview, annotation }, centerX, centerY, 80);
    await annotation.waitForCircleCount(
      axialView,
      2,
      'Rectangle should have two handles'
    );
    await clickToSelect(
      { volview, annotation },
      axialView,
      centerX - 80,
      centerY - 80
    );

    await volview.annotationsModuleTab.click();

    await page.locator('[data-testid="measurements-section"]').click();

    await pressDelete(page);

    await annotation.waitForCircleCount(
      axialView,
      0,
      'Delete should work while a panel control holds focus'
    );
  });

  test('keeps unselected annotations', async ({
    page,
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();

    await placeRectangle(
      { volview, annotation },
      centerX - 80,
      centerY - 80,
      40
    );
    await placeRectangle(
      { volview, annotation },
      centerX + 80,
      centerY + 80,
      40
    );
    await annotation.waitForCircleCount(
      axialView,
      4,
      'Two rectangles should be placed'
    );

    await clickToSelect(
      { volview, annotation },
      axialView,
      centerX - 120,
      centerY - 120
    );
    await pressDelete(page);

    await annotation.waitForCircleCount(
      axialView,
      2,
      'Delete should remove only the selected rectangle'
    );
  });
});
