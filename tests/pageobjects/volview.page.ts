import Page from './page';

async function waitUntilDownloaded(sample: WebdriverIO.Element, name: string) {
  return sample.$('i[class~="mdi-check"]').waitForExist({
    timeout: 60 * 1000,
    timeoutMsg: `Timed out downloading sample: ${name}`,
  });
}

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

    await waitUntilDownloaded(sample, 'MRI Prostate');
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
