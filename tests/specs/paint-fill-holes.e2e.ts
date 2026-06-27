import AppPage from '../pageobjects/volview.page';

describe('Fill Holes paint process', () => {
  beforeEach(async () => {
    await AppPage.open();
    await AppPage.downloadProstateSample();
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
    await AppPage.fillHolesProcessButton.waitForClickable();
    await AppPage.fillHolesProcessButton.click();

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
    await AppPage.processModeButton.waitForClickable();
    await AppPage.processModeButton.click();
    await AppPage.fillHolesProcessButton.waitForClickable();
    await AppPage.fillHolesProcessButton.click();

    await AppPage.processPreviewButton.waitForClickable();
    await AppPage.processPreviewButton.click();

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
});
