import AppPage from '../pageobjects/volview.page';
import { PROSTATEX_DATASET } from './configTestUtils';
import { openUrls } from './utils';

async function startFillHolesPreview() {
  await AppPage.processModeButton.waitForClickable();
  await AppPage.processModeButton.click();
  await AppPage.selectFillHolesProcess();
  await AppPage.processPreviewButton.waitForClickable();
  await AppPage.processPreviewButton.click();
  await AppPage.processApplyButton.waitForDisplayed();
}

describe('Fill Holes paint process', () => {
  beforeEach(async () => {
    await openUrls([PROSTATEX_DATASET]);
    await AppPage.waitForViews();

    const views2D = await AppPage.getViews2D();
    const axialView = views2D[0];

    await AppPage.activatePaint();
    // Paint a shape so the label map has data for the algorithm to process.
    await AppPage.paintStrokeOnView(axialView);
  });

  it('runs the Fill Holes workflow to completion on a painted segment', async () => {
    // Default options: current slice, all segments.
    await AppPage.runFillHoles();

    // The Preview button is back, meaning the process applied without error.
    await expect(AppPage.processPreviewButton).toBeDisplayed();
  });

  it('runs Fill Holes with whole-volume and selected-segment options', async () => {
    await AppPage.processModeButton.waitForClickable();
    await AppPage.processModeButton.click();
    await AppPage.selectFillHolesProcess();

    // Switch both option toggles away from their defaults.
    await AppPage.fillHolesWholeVolumeButton.waitForClickable();
    await AppPage.fillHolesWholeVolumeButton.click();
    await AppPage.fillHolesSelectedSegmentButton.waitForClickable();
    await AppPage.fillHolesSelectedSegmentButton.click();

    await AppPage.processPreviewButton.waitForClickable();
    await AppPage.processPreviewButton.click();

    const apply = AppPage.processApplyButton;
    await apply.waitForDisplayed();
    await apply.waitForClickable();
    await apply.click();

    await expect(AppPage.processPreviewButton).toBeDisplayed();
  });

  it('toggles the preview in place between processed and original', async () => {
    await startFillHolesPreview();

    // Previewing starts on the processed result.
    await AppPage.processProcessedButton.waitForDisplayed();
    await browser.waitUntil(() =>
      AppPage.isPreviewToggleActive(AppPage.processProcessedButton)
    );
    expect(
      await AppPage.isPreviewToggleActive(AppPage.processOriginalButton)
    ).toBe(false);

    // Clicking the already-active button flips the preview in place, without
    // moving the pointer to the other button.
    await AppPage.processProcessedButton.click();
    await browser.waitUntil(() =>
      AppPage.isPreviewToggleActive(AppPage.processOriginalButton)
    );
    expect(
      await AppPage.isPreviewToggleActive(AppPage.processProcessedButton)
    ).toBe(false);
  });

  for (const preview of ['Original', 'Processed']) {
    it(`cancels the ${preview} preview when its segment locks and allows a retry`, async () => {
      await startFillHolesPreview();
      if (preview === 'Original') await AppPage.processOriginalButton.click();
      const lock = $('[data-testid="toggle-segments-locked-button"]');
      await lock.waitForClickable();
      await lock.click();
      await expect(AppPage.processPreviewButton).toBeDisplayed();
      await expect(AppPage.processApplyButton).not.toBeDisplayed();

      await lock.click();
      await AppPage.processPreviewButton.waitForClickable();
      await AppPage.processPreviewButton.click();
      await AppPage.processApplyButton.waitForClickable();
      await AppPage.processApplyButton.click();
      await expect(AppPage.processPreviewButton).toBeDisplayed();
      await expect($('div*=Operation Failed')).not.toBeDisplayed();
    });
  }
});
