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

const LAYOUT_BUTTON_SELECTOR = 'button[data-testid="control-button-Layouts"]';
const LAYOUT_ITEM_SELECTOR = '.v-list-item';
const LAYOUT_ITEM_TITLE_SELECTOR = '.v-list-item-title';
const TWO_D_VIEW_SELECTOR = 'div[data-testid="vtk-view vtk-two-view"]';

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
    return $$('div[data-testid~="vtk-view"] canvas');
  }

  get layoutButton() {
    return $(LAYOUT_BUTTON_SELECTOR);
  }

  get layoutMenuItems() {
    return $$(LAYOUT_ITEM_SELECTOR);
  }

  async waitForViews(timeout = DOWNLOAD_TIMEOUT) {
    await browser.waitUntil(
      async () => {
        try {
          // Query views once per iteration to avoid multiple queries that could become stale
          const currentViews = await this.views;
          const viewCount = await currentViews.length;

          if (viewCount === 0) {
            return false;
          }

          // Check each view's dimensions in a single pass
          const viewPromises = currentViews.map(async (view) => {
            try {
              // Get attributes directly from the element reference
              const width = await view.getAttribute('width');
              const height = await view.getAttribute('height');

              if (width && height) {
                const w = parseInt(width, 10);
                const h = parseInt(height, 10);
                // Canvas should have real dimensions, not be a 1x1 placeholder
                // Accept any size > 10 as a real view
                return w > 10 && h > 10;
              }
              return false;
            } catch (err) {
              // Element may have been removed/recreated - that's ok, we'll retry
              return false;
            }
          });

          const results = await Promise.all(await viewPromises);

          // At least one view must have real dimensions
          return results.some((result) => result);
        } catch (error) {
          // DOM may be updating, retry on next iteration
          return false;
        }
      },
      {
        timeout,
        timeoutMsg: `expected at least 1 view to be rendered with real dimensions (timeout: ${timeout}ms)`,
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

  async waitForViewCounts(
    expected2DCount: number,
    expected3DExists: boolean,
    timeout = DOWNLOAD_TIMEOUT
  ) {
    await browser.waitUntil(
      async () => {
        const views2D = await this.getViews2D();
        const view3D = await this.getView3D();
        const view2DCount = await views2D.length;
        return (
          view2DCount === expected2DCount &&
          (view3D !== null) === expected3DExists
        );
      },
      {
        timeout,
        timeoutMsg: `Expected ${expected2DCount} 2D views and ${
          expected3DExists ? 'a' : 'no'
        } 3D view`,
        interval: 1000,
      }
    );
  }

  async openLayoutMenu(minOptionCount = 1) {
    const button = await this.layoutButton;
    await browser.waitUntil(async () => button.isDisplayed(), {
      timeout: 5000,
      timeoutMsg: 'Layout button not displayed',
      interval: 500,
    });
    await button.click();

    await browser.waitUntil(
      async () => {
        const items = await this.layoutMenuItems;
        const itemCount = await items.length;
        return itemCount >= minOptionCount;
      },
      {
        timeout: 5000,
        timeoutMsg: `Expected layout menu to show at least ${minOptionCount} layout options`,
        interval: 500,
      }
    );
  }

  async getLayoutOptionTitles() {
    return browser.execute((titleSelector: string) => {
      const items = Array.from(document.querySelectorAll(titleSelector));
      return items.map((item) => item.textContent?.trim() ?? '');
    }, LAYOUT_ITEM_TITLE_SELECTOR);
  }

  async selectLayoutOption(targetText: string) {
    await browser.execute(
      (text: string, titleSelector: string) => {
        const items = Array.from(document.querySelectorAll(titleSelector));
        const targetItem = items.find(
          (item) => item.textContent?.trim() === text
        );
        if (!targetItem) return;
        const listItem = targetItem.closest(
          '.v-list-item'
        ) as HTMLElement | null;
        listItem?.click();
      },
      targetText,
      LAYOUT_ITEM_TITLE_SELECTOR
    );
  }

  async focusFirst2DView() {
    const views = await this.getViews2D();
    const viewCount = await views.length;
    if (!viewCount) {
      throw new Error('No 2D views rendered to focus');
    }

    const firstView = views[0];
    const canvas = await firstView.$('canvas');
    await canvas.scrollIntoView();
    await canvas.click();
  }

  async getFirst2DSlice() {
    return browser.execute((selector: string) => {
      const views = document.querySelectorAll(selector);
      if (views.length === 0) return null;
      const overlayText = views[0].textContent;
      const match = overlayText?.match(/Slice:\s*(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    }, TWO_D_VIEW_SELECTOR);
  }

  async advanceSlice(steps = 5, pauseMs = 200) {
    const keySequence = Array.from({ length: steps }, () => Key.ArrowDown);
    await browser.keys(keySequence);
    if (pauseMs > 0) {
      await browser.pause(pauseMs);
    }
  }

  async waitForSliceIncrease(initialSlice: number | null, timeout = 3000) {
    await browser.waitUntil(
      async () => {
        const currentSlice = await this.getFirst2DSlice();
        if (initialSlice === null) {
          return currentSlice !== null;
        }
        return currentSlice !== null && currentSlice > initialSlice;
      },
      {
        timeout,
        timeoutMsg: 'Expected slice to change after advancing',
        interval: 200,
      }
    );
  }

  async waitForLoadingIndicator(
    view: ChainablePromiseElement,
    timeout = DOWNLOAD_TIMEOUT
  ) {
    await browser.waitUntil(
      async () => {
        const loadingIndicator = await view.$('.loading-indicator');
        return !(await loadingIndicator.isDisplayed());
      },
      {
        timeout,
        timeoutMsg: 'Expected loading indicator to disappear',
      }
    );
  }
}

export const volViewPage = new VolViewPage();

export default volViewPage;
