import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  containsText,
  exactText,
  setValueVueInput,
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { Utils } from './utils';

const layer = (page: Page) =>
  page.locator('section[aria-label="contrast-target.nrrd"]');
const other = (page: Page) =>
  page.locator('section[aria-label="contrast-other.mha"]');
const targetInput = (page: Page, endpoint: string) =>
  layer(page).locator(`[data-testid="layer-range-${endpoint}"] input`);
const visibility = (page: Page) =>
  layer(page).locator('[data-testid="layer-visibility"]');

const appliedRange = async (page: Page) =>
  Promise.all(
    ['min', 'max'].map(async (endpoint) =>
      Number(await targetInput(page, endpoint).getAttribute('title'))
    )
  );

const pixels = (utils: Utils) =>
  utils.capture2DViewScreenshotMetrics('overlay-auto-contrast.png');

const moveToHeader = (page: Page, utils: Utils) =>
  utils.moveToElement(page.locator('header'));

async function openContrast(page: Page) {
  const trigger = layer(page).locator('[data-testid="layer-contrast"]');
  await trigger.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await trigger.click();
  await waitForTransitions(page.locator('[data-testid="layer-contrast-menu"]'));
}

async function chooseContrast(page: Page, option: string) {
  await openContrast(page);
  const item = page.locator(`[data-testid="layer-contrast-${option}"]`);
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();
  await expect(
    page.locator('[data-testid="layer-contrast-menu"]')
  ).toBeHidden();
}

async function unrelatedSettings(page: Page) {
  return {
    baseMin: await page
      .locator('[data-testid="base-image-range-min"] input')
      .getAttribute('title'),
    baseMax: await page
      .locator('[data-testid="base-image-range-max"] input')
      .getAttribute('title'),
    basePalette: await page
      .locator('[data-testid="base-image-colormap"]')
      .innerText(),
    palette: await layer(page)
      .locator('[data-testid="layer-colormap"]')
      .innerText(),
    opacity: await layer(page)
      .locator('[data-testid="layer-opacity-slider"] input')
      .inputValue(),
    transparent: await layer(page)
      .locator('[data-testid="layer-transparent-background"] input')
      .isChecked(),
    otherMin: await other(page)
      .locator('[data-testid="layer-range-min"] input')
      .getAttribute('title'),
    otherMax: await other(page)
      .locator('[data-testid="layer-range-max"] input')
      .getAttribute('title'),
    otherPalette: await other(page)
      .locator('[data-testid="layer-colormap"]')
      .innerText(),
    otherOpacity: await other(page)
      .locator('[data-testid="layer-opacity-slider"] input')
      .inputValue(),
  };
}

async function openContrastFixture({
  page,
  volview,
  utils,
}: {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
}) {
  const dir = utils.makeTempDir('overlay-contrast');
  const header = [
    'NRRD0005',
    'type: short',
    'dimension: 3',
    'sizes: 16 16 16',
    'space: left-posterior-superior',
    'space directions: (2,0,0) (0,2,0) (0,0,2)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ].join('\n');
  const values = Array.from({ length: 4096 }, (_, i) =>
    i === 0 ? 0 : i === 4095 ? 1000 : 200 + ((i * 17) % 600)
  );
  writeFileSync(
    join(dir, 'contrast-target.nrrd'),
    `${header}\n\n${values.join(' ')}`
  );
  const base = utils.writeMetaImage('contrast-base.mha', {
    size: 32,
    step: 17,
  });
  const second = utils.writeMetaImage('contrast-other.mha', {
    size: 32,
    step: 29,
  });
  await utils.writeManifestToFile(
    {
      version: '7.0.0',
      dataSources: [base, 'overlay-contrast/contrast-target.nrrd', second].map(
        (name, i) => ({
          id: i + 1,
          type: 'uri',
          uri: `/tmp/${name}`,
          name: name.split('/').at(-1),
        })
      ),
      datasets: ['base', 'target', 'other'].map((id, i) => ({
        id,
        dataSourceId: i + 1,
      })),
      primarySelection: 'base',
      parentToLayers: [
        { selectionKey: 'base', sourceSelectionKeys: ['target', 'other'] },
      ],
      layerDisplay: {
        'base::target': {
          preset: 'DICOM Hot Iron',
          mappingRange: [-2000, -1000],
          opacity: 0.8,
          transparentBackground: false,
        },
        'base::other': {
          preset: 'Cool to Warm',
          mappingRange: [20, 230],
          opacity: 0.2,
          transparentBackground: false,
        },
      },
    },
    'overlay-auto-contrast.json'
  );
  await utils.openVolViewPage('overlay-auto-contrast.json');
  await page
    .locator('.image-list-card', { hasText: containsText(base) })
    .locator('[data-testid="dataset-menu-button"]')
    .click();
  const showInAllViews = page.locator('.v-list-item', {
    hasText: containsText('Show in all views'),
  });
  await expect(showInAllViews).toBeVisible();
  await expect(showInAllViews).toBeEnabled();
  await waitForTransitions(
    page.locator('.v-menu.v-overlay--active .v-overlay__content')
  );
  await showInAllViews.click();
  await page.keyboard.press('Escape');
  await volview.renderingModuleTab.click();
  await page.locator('[data-testid="volume-rendering-toggle"]').click();
  await utils.waitForModuleTransitions();
  await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
  await expect(targetInput(page, 'min')).toHaveAttribute('title', '-2000');
}

test.describe('Overlay automatic contrast', () => {
  test('shows contrast choices between the range inputs and applies the full range', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    await openContrastFixture({ page, volview, utils });
    const trigger = layer(page).locator('[data-testid="layer-contrast"]');
    await expect(trigger.locator('.mdi-circle-half-full')).toBeAttached();
    await expect(trigger.locator('.mdi-menu-down')).toBeAttached();
    const minX = (await targetInput(page, 'min').boundingBox())!.x;
    const maxX = (await targetInput(page, 'max').boundingBox())!.x;
    const triggerX = (await trigger.boundingBox())!.x;
    expect(triggerX).toBeGreaterThan(minX);
    expect(triggerX).toBeLessThan(maxX);
    const unchanged = await unrelatedSettings(page);
    await openContrast(page);
    expect(await appliedRange(page)).toEqual([-2000, -1000]);
    const menu = page.locator('[data-testid="layer-contrast-menu"]');
    await expect(menu).toHaveText(
      'Full Range\nLow Contrast\nMedium Contrast\nHigh Contrast',
      { useInnerText: true }
    );
    await page.screenshot({
      path: scratch.track(scratch.path('overlay-contrast-controls.png')),
    });
    await expect(menu.locator('input')).not.toBeAttached();
    await expect(
      menu.locator('label', { hasText: exactText('Bones') })
    ).not.toBeAttached();
    await page.locator('[data-testid="layer-contrast-FullRange"]').click();
    await expect(targetInput(page, 'min')).toHaveAttribute('title', '0');
    await expect(targetInput(page, 'max')).toHaveAttribute('title', '1000');
    expect(await unrelatedSettings(page)).toEqual(unchanged);
  });

  test('uses its resampled histogram for progressively narrower contrast in every slice', async ({
    page,
    volview,
    utils,
  }) => {
    await openContrastFixture({ page, volview, utils });
    const unchanged = await unrelatedSettings(page);
    await chooseContrast(page, 'FullRange');
    const widths: number[] = [];
    for (const choice of ['LowContrast', 'MediumContrast', 'HighContrast']) {
      await moveToHeader(page, utils);
      const before = await pixels(utils);
      await chooseContrast(page, choice);
      const [min, max] = await appliedRange(page);
      // Resampling adds over 5% zero padding; source percentiles start above 200.
      expect(min).toBe(0);
      expect(max).toBeLessThanOrEqual(1000);
      expect(max).toBeGreaterThan(min);
      widths.push(max - min);
      await moveToHeader(page, utils);
      await expect
        .poll(
          async () => {
            const after = await pixels(utils);
            return (
              after.length === 3 &&
              after.every((view, i) => view.checksum !== before[i].checksum)
            );
          },
          {
            message:
              'Expected overlay contrast to change every slice rendering',
          }
        )
        .toBe(true);
      expect(await unrelatedSettings(page)).toEqual(unchanged);
    }
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  test('resets edited ranges and invalid drafts without changing other display settings', async ({
    page,
    volview,
    utils,
  }) => {
    await openContrastFixture({ page, volview, utils });
    const unchanged = await unrelatedSettings(page);
    await chooseContrast(page, 'FullRange');
    await setValueVueInput(targetInput(page, 'min'), '-2000');
    await setValueVueInput(targetInput(page, 'max'), '-1000');
    await page.keyboard.press('Enter');
    await chooseContrast(page, 'FullRange');
    expect(await appliedRange(page)).toEqual([0, 1000]);
    await setValueVueInput(targetInput(page, 'min'), '-');
    await page.keyboard.press('Enter');
    const status = layer(page).locator('[data-testid="layer-range-status"]');
    await expect(status).toBeVisible();
    await chooseContrast(page, 'FullRange');
    await expect(targetInput(page, 'min')).toHaveValue('0');
    await expect(targetInput(page, 'max')).toHaveValue('1000');
    await expect(status).not.toBeAttached();
    expect(await unrelatedSettings(page)).toEqual(unchanged);
  });

  test('hides and restores the overlay in every slice without changing display settings', async ({
    page,
    volview,
    utils,
  }) => {
    await openContrastFixture({ page, volview, utils });
    const unchanged = await unrelatedSettings(page);
    await chooseContrast(page, 'FullRange');
    await expect(visibility(page)).toContainText('HIDE', {
      useInnerText: true,
    });
    expect((await visibility(page).boundingBox())!.x).toBeLessThan(
      (await layer(page)
        .locator('[data-testid="layer-colormap"]')
        .boundingBox())!.x
    );
    const borderRadius = (element: Element) =>
      getComputedStyle(element).borderRadius;
    expect(await visibility(page).evaluate(borderRadius)).toBe(
      await layer(page)
        .locator('[data-testid="layer-contrast"]')
        .evaluate(borderRadius)
    );
    await expect(visibility(page).locator('.mdi-eye')).toBeAttached();
    await moveToHeader(page, utils);
    const shown = await pixels(utils);
    await visibility(page).evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await visibility(page).click();
    await expect(visibility(page)).toContainText('SHOW', {
      useInnerText: true,
    });
    await expect(visibility(page).locator('.mdi-eye-off')).toBeAttached();
    await moveToHeader(page, utils);
    await expect
      .poll(async () => {
        const hidden = await pixels(utils);
        return (
          hidden.length === 3 &&
          hidden.every((view, i) => view.checksum !== shown[i].checksum)
        );
      })
      .toBe(true);
    expect(await unrelatedSettings(page)).toEqual(unchanged);
    await visibility(page).click();
    await moveToHeader(page, utils);
    await expect
      .poll(async () => {
        const restored = await pixels(utils);
        return (
          restored.length === 3 &&
          restored.every((view, i) => view.checksum === shown[i].checksum)
        );
      })
      .toBe(true);
    expect(await unrelatedSettings(page)).toEqual(unchanged);
  });

  test('preserves hidden overlay settings through layout changes and a saved session', async ({
    page,
    volview,
    utils,
  }) => {
    await openContrastFixture({ page, volview, utils });
    const unchanged = await unrelatedSettings(page);
    await chooseContrast(page, 'FullRange');
    await visibility(page).evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await visibility(page).click();
    await utils.selectLayout('Axial Only', 1, false);
    await expect(visibility(page)).toContainText('SHOW', {
      useInnerText: true,
    });
    expect(await unrelatedSettings(page)).toEqual(unchanged);
    const saved = await volview.saveSession();
    await utils.openVolViewPage(saved);
    await volview.renderingModuleTab.click();
    await visibility(page).evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(visibility(page)).toContainText('SHOW', {
      useInnerText: true,
    });
    await utils.selectLayout('Four Up', 3, true);
    await expect(visibility(page)).toContainText('SHOW', {
      useInnerText: true,
    });
    expect(await unrelatedSettings(page)).toEqual(unchanged);
    await moveToHeader(page, utils);
    const hidden = await pixels(utils);
    await visibility(page).click();
    await expect(visibility(page)).toContainText('HIDE', {
      useInnerText: true,
    });
    await moveToHeader(page, utils);
    await expect
      .poll(async () => {
        const restored = await pixels(utils);
        return (
          restored.length === 3 &&
          restored.every((view, i) => view.checksum !== hidden[i].checksum)
        );
      })
      .toBe(true);
    expect(await unrelatedSettings(page)).toEqual(unchanged);
  });
});
