import Page from './page';

class VolViewPage extends Page {
  get samplesList() {
    return $('div[data-testid="samples-list"]');
  }

  get prostateSample() {
    return this.samplesList.$('div[title="MRI PROSTATEx"]');
  }

  get layoutGrid() {
    return $('div[data-testid="layout-grid"]');
  }

  async downloadProstateSample() {
    const sample = await this.prostateSample;
    await sample.click();
  }

  get views() {
    return $$('div[data-testid~="vtk-view"] > canvas');
  }

  async waitForViews() {
    const this_ = this;
    await browser.waitUntil(async function viewsExist() {
      const views = await this_.views;
      return (
        views.length > 0 && views.every((view) => view.isDisplayedInViewport())
      );
    });
  }
}

export default new VolViewPage();
