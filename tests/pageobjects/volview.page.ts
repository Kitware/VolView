import * as path from 'path';
import * as fs from 'fs';
import { Key } from 'webdriverio';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { DOWNLOAD_TIMEOUT, TEMP_DIR } from '../../wdio.shared.conf';
import Page from './page';

let lastId = 0;
const getId = () => {
  return lastId++;
};

export const setValueVueInput = async (
  input: WebdriverIO.Element,
  value: string
) => {
  // input.setValue does not clear existing input, so click and backspace
  await input.click();
  const oldValue = await input.getValue();
  if (oldValue) {
    const backspaces = new Array(oldValue.length).fill(Key.Backspace);
    await browser.keys([Key.ArrowRight, ...backspaces]);
  }
  await input.setValue(value);

  // await browser.keys([Key.Enter]);
};

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

  async waitForViews(timeout = DOWNLOAD_TIMEOUT) {
    const this_ = this;
    await browser.waitUntil(
      async function viewsExist() {
        const views = await this_.views;
        if (views.length === 0) return false;
        const inView = await Promise.all(
          views.map((v) => v.isDisplayedInViewport())
        );
        return inView.every(Boolean);
      },
      { timeout }
    );
  }

  get rectangleButton() {
    return $('button span i[class~=mdi-vector-square]');
  }

  async activateRectangle() {
    const button = await this.rectangleButton;
    await button.click();
  }

  get twoViews() {
    return $$('div[data-testid~="vtk-two-view"] > canvas');
  }

  async clickTwiceInTwoView() {
    const views = await this.twoViews;
    const view = views[0];
    await view.click({ x: 1, y: 1 });
    await view.click({ x: 5, y: 5 });
  }

  get saveButton() {
    return $('button span i[class~=mdi-content-save-all]');
  }

  get saveSessionFilenameInput() {
    return $('#session-state-filename');
  }

  get saveSessionConfirmButton() {
    return $('span[data-testid="save-session-confirm-button"]');
  }

  async saveSession() {
    const save = await this.saveButton;
    await save.click();

    const input = await this.saveSessionFilenameInput;
    const id = getId();
    const fileName = `${id}-session.volview.zip`;

    await setValueVueInput(input, fileName);

    const confirm = await this.saveSessionConfirmButton;
    await confirm.click();

    cleanuptotal.addCleanup(async () => {
      fs.unlinkSync(path.join(TEMP_DIR, fileName));
    });

    return fileName;
  }

  get editLabelButtons() {
    return $$('button[data-testid="edit-label-button"]');
  }

  get labelStrokeWidthInput() {
    return $('#label-stroke-width-input');
  }

  get editLabelModalDoneButton() {
    return $('button[data-testid="edit-label-done-button"]');
  }
}

export const volViewPage = new VolViewPage();

export default volViewPage;
