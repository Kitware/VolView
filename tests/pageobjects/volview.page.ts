import * as path from 'path';
import Page from './page';
import { projectRoot } from '../e2eTestUtils';

const ROOT = projectRoot();

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

  get ctaHeadAndNeckSample() {
    return this.samplesList.$('div[title="CTA Head and Neck"]');
  }

  get layoutGrid() {
    return $('div[data-testid="layout-grid"]');
  }

  async downloadHeadAndNeckSample() {
    const sample = await this.ctaHeadAndNeckSample;
    await sample.click();

    await waitUntilDownloaded(sample, 'CTA Head and Neck');
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

    // This ensures the elements have been painted. No image comparison
    // is done here.
    await Promise.all(
      (
        await this.views
      ).map(async (el, idx) => {
        return el.saveScreenshot(path.join(ROOT, `.tmp/views-${idx}.png`));
      })
    );
  }
}

export default new VolViewPage();
