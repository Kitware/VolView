import * as path from 'path';
import * as fs from 'fs';
import { Key, type ChainablePromiseElement } from 'webdriverio';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { DOWNLOAD_TIMEOUT, TEMP_DIR } from '../../wdio.shared.conf';
import Page from './page';

let lastId = 0;
const getId = () => {
  return lastId++;
};

export const setValueVueInput = async (
  input: ChainablePromiseElement,
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
        const viewCount = await views.length;

        if (viewCount === 0) return false;

        // Check if at least one view has real dimensions
        const viewsArray = await Promise.all(
          Array.from({ length: viewCount }).map(async (_, i) => {
            const view = views[i];
            const [width, height, exists] = await Promise.all([
              view.getAttribute('width').catch(() => null),
              view.getAttribute('height').catch(() => null),
              view.isExisting().catch(() => false),
            ]);

            // Canvas should have real dimensions, not be a 1x1 placeholder
            // Accept any size > 10 as a real view
            if (width && height && exists) {
              const w = parseInt(width, 10);
              const h = parseInt(height, 10);
              return w > 10 && h > 10;
            }
            return false;
          })
        );

        return viewsArray.some(Boolean);
      },
      {
        timeout,
        interval: 1000,
        timeoutMsg: `expected at least 1 view to be rendered with real dimensions`,
      }
    );
  }

  get notifications() {
    return $('#notifications');
  }

  async getNotificationsCount() {
    const badge = this.notifications.$('span[aria-label="Badge"]');
    const innerText = await badge.getText();
    if (innerText === '') return 0;
    return parseInt(innerText, 10);
  }

  async waitForNotification() {
    const this_ = this;
    await browser.waitUntil(
      async () => {
        const notificationCount = await this_.getNotificationsCount();
        return notificationCount >= 1;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: `expected notification badge to display`,
      }
    );
  }

  get rectangleButton() {
    return $('button span i[class~=mdi-vector-square]');
  }

  async activateRectangle() {
    const button = this.rectangleButton;
    await button.click();
  }

  get twoViews() {
    return $$('div[data-testid~="vtk-two-view"] > canvas');
  }

  get viewTwoContainer() {
    return $('div[data-testid~="two-view-container"]');
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
    const save = this.saveButton;
    await save.click();

    const input = this.saveSessionFilenameInput;
    const id = getId();
    const fileName = `${id}-session.volview.zip`;

    await setValueVueInput(input, fileName);

    const confirm = this.saveSessionConfirmButton;
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
    // there should only be one on the screen at any given time
    return $('.label-stroke-width-input').$('input');
  }

  get editLabelModalDoneButton() {
    return $('button[data-testid="edit-label-done-button"]');
  }

  get datasetMenuButtons() {
    return $$('button[data-testid="dataset-menu-button"]');
  }

  get renderingModuleTab() {
    return $('button[data-testid="module-tab-Rendering"]');
  }

  get layerOpacitySliders() {
    return $$('div[data-testid="layer-opacity-slider"]');
  }

  async getVolumeRenderingSection() {
    const pwfEditor = await $('div.pwf-editor');
    const exists = await pwfEditor.isExisting();
    return exists ? pwfEditor : null;
  }

  get create3DViewMessage() {
    return $('div.text-body-2.text-center.text-medium-emphasis');
  }

  async getView3D() {
    const view3D = $('div[data-testid="vtk-view vtk-volume-view"]');
    const exists = await view3D.isExisting();
    return exists ? view3D : null;
  }

  async getView2D() {
    const view2D = $('div[data-testid="vtk-view vtk-two-view"]');
    const exists = await view2D.isExisting();
    return exists ? view2D : null;
  }

  async getViews2D() {
    const views2D = $$('div[data-testid="vtk-view vtk-two-view"]');
    return views2D;
  }
}

export const volViewPage = new VolViewPage();

export default volViewPage;
