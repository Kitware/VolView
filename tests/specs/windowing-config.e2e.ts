import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  setValueVueInput,
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM, MINIMAL_DICOM } from '../datasets';
import { displayedWindow } from './octTestUtils';

async function setManualWindow(
  page: Page,
  view: Locator,
  width: number,
  level: number
) {
  await view.locator('canvas').first().click();
  await page
    .locator('button[data-testid^="control-button-Window & Level "]')
    .click();
  const inputs = page.locator('.v-overlay--active .manual-inputs input');
  await expect(inputs.nth(0)).toBeVisible();
  await waitForTransitions(inputs.nth(0));
  await expect(inputs.nth(0)).toBeEnabled();
  // The active class leaves as the menu closes, so follow the field itself.
  const field = await inputs.nth(0).elementHandle();
  await setValueVueInput(inputs.nth(0), String(width));
  await setValueVueInput(inputs.nth(1), String(level));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await field?.waitForElementState('hidden');
  expect(await displayedWindow(view)).toEqual({ width, level });
}

const expectWindowLevel = async (
  page: Page,
  volview: VolViewPage,
  width: number,
  level: number
) => {
  const view = page.locator('div[data-testid="vtk-view vtk-two-view"]').first();
  await volview.waitForLoadingIndicator(view);
  await expect(view.locator('.view-annotations')).toContainText(
    `W/L: ${width.toFixed(2)} / ${level.toFixed(2)}`
  );
};

test.describe('VolView windowing configuration', () => {
  test('should use runtime config window level over DICOM window level', async ({
    page,
    volview,
    configUtils,
  }) => {
    const runtimeWindowLevel = {
      width: 2000,
      level: 1000,
    };

    const config = {
      windowing: runtimeWindowLevel,
    };

    await configUtils.openConfigAndDataset(config, 'windowing');
    await expectWindowLevel(
      page,
      volview,
      runtimeWindowLevel.width,
      runtimeWindowLevel.level
    );
  });

  test('should use DICOM window level when no runtime config is provided', async ({
    page,
    volview,
    utils,
  }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await expectWindowLevel(page, volview, 410, 70);
  });

  test('should use auto windowing for DICOM without window/level metadata', async ({
    page,
    volview,
    utils,
  }) => {
    await utils.openUrls([MINIMAL_DICOM]);
    await expectWindowLevel(page, volview, 1900, 1050);
  });

  test('retains synchronized source contrast when a peer returns from another dataset', async ({
    page,
    volview,
    utils,
  }) => {
    const source = utils.writeMetaImage('windowing-source.mha');
    const other = utils.writeMetaImage('windowing-other.mha', { step: 29 });
    const manifest = 'windowing-dataset-switch.json';
    await utils.writeManifestToFile(
      {
        resources: [source, other].map((name) => ({
          url: '/tmp/' + name,
          name,
        })),
      },
      manifest
    );
    await utils.openVolViewPage(manifest);
    await volview.waitForViewCounts(3, true);
    await page.locator('button[data-testid="module-tab-Data"]').click();
    const sourceCard = page.locator(
      '.image-list-card:has([title="' + source + '"])'
    );
    const otherCard = page.locator(
      '.image-list-card:has([title="' + other + '"])'
    );
    await expect(sourceCard).toBeVisible();
    await expect(otherCard).toBeVisible();
    await sourceCard.locator('[data-testid="dataset-menu-button"]').click();
    const showAll = utils.overlayOption('Show in all views');
    // The option's overlay loses its active class on close, so follow the item.
    const item = await showAll.elementHandle();
    await showAll.click();
    await page.keyboard.press('Escape');
    await item?.waitForElementState('hidden');

    const origin = volview.views2D.nth(0);
    const peer = volview.views2D.nth(1);
    await expect(origin).toContainText(source);
    await setManualWindow(page, origin, 160, 120);
    expect(await displayedWindow(peer)).toEqual({ width: 160, level: 120 });
    await peer.locator('canvas').first().click();
    await otherCard.click();
    await expect(peer).toContainText(other);
    const otherWindow = await displayedWindow(peer);

    await setManualWindow(page, origin, 80, 60);
    expect(await displayedWindow(peer)).toEqual(otherWindow);

    await peer.locator('canvas').first().click();
    await sourceCard.click();
    await expect(peer).toContainText(source);
    await expect
      .poll(
        async () => {
          const current = await displayedWindow(peer);
          return current.width === 80 && current.level === 60;
        },
        {
          message:
            'A peer returning to the source must retain its synchronized contrast',
        }
      )
      .toBe(true);
  });
});
