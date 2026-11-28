import type { Page } from '@playwright/test';
import { test, expect, registerOctTestHooks } from '../fixtures';
import { CANVAS, MENU_PANEL } from './octTestUtils';
import { reference, SLICE_LINE } from './octInteractionTestUtils';

async function lineCoordinates(page: Page) {
  return Promise.all(
    ['x1', 'x2', 'y1', 'y2'].map(async (attribute) => {
      const value = await page
        .locator(SLICE_LINE)
        .first()
        .getAttribute(attribute);
      if (value === null)
        throw new Error('Missing reference-line ' + attribute);
      return Number(value);
    })
  );
}

test.describe('En face reference line visibility', () => {
  registerOctTestHooks();

  test('keeps source reference lines visible while the projection is maximized', async ({
    page,
    volview,
    oct,
    octInteraction,
  }) => {
    const canvas = page.locator(CANVAS).first();
    await octInteraction.openRetina(false, true);
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU_PANEL)).toBeHidden();
    await page.locator('button[data-testid^="control-button-Select "]').click();
    await volview.focusFirst2DView();
    await octInteraction.expectSliceLine();
    const before = await lineCoordinates(page);
    await canvas.click();
    await canvas.dblclick();
    await expect(
      page.locator('div[data-testid~="vtk-two-view"]')
    ).not.toBeAttached();
    await oct.waitForEnFaceReady();
    await expect(page.locator(SLICE_LINE)).toHaveCount(1);
    const tolerance = 64 * Number.EPSILON * Math.max(...reference.size);
    await expect
      .poll(
        async () =>
          (await lineCoordinates(page)).every(
            (value, index) =>
              Number.isFinite(value) &&
              Math.abs(value - before[index]) <= tolerance
          ),
        { message: 'Expected unchanged source reference-line endpoints' }
      )
      .toBe(true);
    await canvas.dblclick();
    await expect(
      page.locator('div[data-testid~="vtk-two-view"] canvas')
    ).toBeVisible();
    await octInteraction.expectSliceLine();
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
