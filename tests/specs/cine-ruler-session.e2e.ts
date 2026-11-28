// Validates that the schema/serializer round-trips the cine annotation
// `frame` field: a ruler placed on cine frame N reloads visible only at
// frame N. A regression in either the zod schema or addTool defaults would
// silently lose the per-frame association.
import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import type { CineUtils } from './cineTestUtils';

const placeRulerAtCanvasCenter = async (page: Page, cine: CineUtils) => {
  await page.locator('button span i[class~=mdi-ruler]').click();
  const { cx, cy } = await cine.getCineCanvasCenter();
  await cine.clickAt(cx - 40, cy);
  await cine.clickAt(cx + 40, cy);
};

test.describe('Cine ruler survives save/reload at its placed frame', () => {
  test('reloads at the persisted frame with the ruler visible and hides it on frame 1', async ({
    page,
    volview,
    cine,
    segmentation,
  }) => {
    // Scrub to a non-default frame so a regression dropping `frame` would
    // pin the ruler to frame 0 — visually indistinguishable from "ruler
    // attached but tagged with the wrong frame".
    const placementFrame = await cine.openCinePastFirstFrame();

    await placeRulerAtCanvasCenter(page, cine);
    await expect
      .poll(cine.countCineRulerLines, {
        message: 'Expected the placed ruler line to render',
      })
      .toBeGreaterThanOrEqual(1);

    // Save → wait for the .zip on disk.
    const sessionFileName = await volview.saveSession();

    // Reload from the saved session — opens a fresh app state.
    await volview.open(`?urls=[tmp/${sessionFileName}]`);
    await volview.waitForViews();
    await expect(page.locator('.play-controls').first()).toBeVisible();
    // The cine frame is persisted, so reload restores the cursor to
    // placementFrame rather than frame 1.
    await cine.waitForFrame(placementFrame);

    // Wait for the deserialized ruler to surface in the Measurements list
    // before asserting visibility on the canvas. The list entry proves
    // deserialization has completed, so the subsequent canvas checks
    // can't race the load.
    await segmentation.openSegmentShapes();
    await expect
      .poll(
        () =>
          page.locator('[data-testid="segment-shape-row"] i.mdi-ruler').count(),
        {
          message:
            'Expected the deserialized ruler entry to appear in the list',
        }
      )
      .toBeGreaterThanOrEqual(1);

    // The ruler must be visible at the persisted placement frame — if
    // `frame` was lost during serialize/deserialize, it would still
    // render here, so we also need to verify it hides elsewhere.
    await expect
      .poll(cine.countCineRulerLines, {
        message: `Expected the ruler to be visible at the persisted placement frame (${placementFrame}) after reload`,
      })
      .toBeGreaterThanOrEqual(1);

    // Scrub back to frame 1 — the ruler must hide there. A regression
    // that dropped `frame` would leave it visible on every frame.
    await volview.focusFirst2DView();
    while ((await cine.getCineFrame())! > 1) {
      await cine.retreatCineFrame();
    }
    await expect
      .poll(cine.countCineRulerLines, {
        message: 'Expected the ruler to hide on frame 1 after reload',
      })
      .toBe(0);
  });
});
