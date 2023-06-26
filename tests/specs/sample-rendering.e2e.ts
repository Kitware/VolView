import AppPage from '../pageobjects/volview.page';

describe('VolView', () => {
  it('should load', async () => {
    await AppPage.open();
    await AppPage.downloadHeadAndNeckSample();
    await AppPage.waitForViews();

    const misMatchPercentage = await browser.checkElement(
      await $('div[data-testid~="vtk-three-view"] > canvas'),
      'neck_sample_three_view'
    );

    expect(misMatchPercentage).toBeLessThan(10);
  });
});
