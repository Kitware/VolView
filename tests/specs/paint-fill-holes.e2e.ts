import { test, expect } from '../fixtures';
import { PROSTATEX_DATASET } from '../datasets';
import { containsText, type VolViewPage } from '../pageobjects/volview.page';

async function startFillHolesPreview(volview: VolViewPage) {
  await volview.processModeButton.click();
  await volview.selectFillHolesProcess();
  await volview.processPreviewButton.click();
  await expect(volview.processApplyButton).toBeVisible();
}

test.describe('Fill Holes paint process', () => {
  test.beforeEach(async ({ volview, utils }) => {
    await utils.openUrls([PROSTATEX_DATASET]);

    const axialView = volview.views2D.first();

    await volview.activatePaint();
    // Paint a shape so the label map has data for the algorithm to process.
    await volview.paintStrokeOnView(axialView);
  });

  test('runs the Fill Holes workflow to completion on a painted segment', async ({
    volview,
  }) => {
    // Default options: current slice, all segments.
    await volview.runFillHoles();

    // The Preview button is back, meaning the process applied without error.
    await expect(volview.processPreviewButton).toBeVisible();
  });

  test('runs Fill Holes with whole-volume and selected-segment options', async ({
    volview,
  }) => {
    await volview.processModeButton.click();
    await volview.selectFillHolesProcess();

    // Switch both option toggles away from their defaults.
    await volview.fillHolesWholeVolumeButton.click();
    await volview.fillHolesSelectedSegmentButton.click();

    await volview.processPreviewButton.click();

    const apply = volview.processApplyButton;
    await expect(apply).toBeVisible();
    await apply.click();

    await expect(volview.processPreviewButton).toBeVisible();
  });

  for (const preview of ['Original', 'Processed']) {
    test(`cancels the ${preview} preview when its segment locks and allows a retry`, async ({
      page,
      volview,
    }) => {
      await startFillHolesPreview(volview);
      if (preview === 'Original') await volview.processOriginalButton.click();
      const lock = page.locator(
        '[data-testid="toggle-segments-locked-button"]'
      );
      await lock.click();
      await expect(volview.processPreviewButton).toBeVisible();
      await expect(volview.processApplyButton).toBeHidden();

      await lock.click();
      await volview.processPreviewButton.click();
      await volview.processApplyButton.click();
      await expect(volview.processPreviewButton).toBeVisible();
      await expect(
        page
          .locator('div', { hasText: containsText('Operation Failed') })
          .first()
      ).toBeHidden();
    });
  }
});
