import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  containsText,
  setValueVueInput,
  waitForTransitions,
} from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  type LayerDisplayUtils,
} from './layerDisplayTestUtils';
import type { Utils } from './utils';

async function openRanges(
  {
    page,
    utils,
    layerDisplay,
  }: {
    page: Page;
    utils: Utils;
    layerDisplay: LayerDisplayUtils;
  },
  overlayRange: [number, number]
) {
  const directory = utils.makeTempDir('number-steppers');
  const files = [[-1000, 500], overlayRange].map((range, image) => {
    const name = `steppers-${image}.nrrd`;
    const header = [
      'NRRD0005',
      'type: double',
      'dimension: 3',
      'sizes: 16 16 16',
      'space: left-posterior-superior',
      'space directions: (1,0,0) (0,1,0) (0,0,1)',
      'space origin: (0,0,0)',
      'encoding: ascii',
    ].join('\n');
    const values = Array.from({ length: 4096 }, (_, i) => range[i % 2]).join(
      ' '
    );
    writeFileSync(join(directory, name), `${header}\n\n${values}`);
    return `number-steppers/${name}`;
  });
  await utils.writeManifestToFile(
    {
      ...layeredImageManifest(files[0], files[1]),
      layerDisplay: {
        'base::overlay': {
          preset: 'DICOM Hot Iron',
          mappingRange: overlayRange,
          opacity: 0.5,
          transparentBackground: false,
        },
      },
    },
    'number-steppers.json'
  );
  await utils.openVolViewPage('number-steppers.json');
  await page
    .locator('.image-list-card', { hasText: containsText('steppers-0.nrrd') })
    .locator('[data-testid="dataset-menu-button"]')
    .click();
  const show = page.locator('.v-list-item', {
    hasText: containsText('Show in all views'),
  });
  await show.click();
  await page.keyboard.press('Escape');
  await layerDisplay.openLayerDisplayControls();
}

const control = (page: Page, id: string) =>
  page.locator(`[data-testid="${id}"]`);
const input = (page: Page, prefix: string, endpoint: string) =>
  control(page, `${prefix}-${endpoint}`).locator('input');
const opacityOf = async (page: Page, id: string) =>
  Number(
    await control(page, id)
      .locator('..')
      .evaluate((element) => getComputedStyle(element).opacity)
  );

async function expectEndpoint(
  page: Page,
  [prefix, endpoint]: [string, string],
  expected: number,
  tolerance: number
) {
  await expect
    .poll(async () =>
      Math.abs(
        Number(await input(page, prefix, endpoint).getAttribute('title')) -
          expected
      )
    )
    .toBeLessThan(tolerance);
}

async function reversibleStep(
  { page, utils }: { page: Page; utils: Utils },
  [prefix, endpoint]: [string, string],
  step: number
) {
  const field = input(page, prefix, endpoint);
  const other = input(page, prefix, endpoint === 'min' ? 'max' : 'min');
  const original = Number(await field.getAttribute('title'));
  const unchanged = await other.getAttribute('title');
  await field.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await utils.moveToElement(control(page, `${prefix}-${endpoint}`));
  const increase = control(page, `${prefix}-${endpoint}-increase`);
  const decrease = control(page, `${prefix}-${endpoint}-decrease`);
  expect(await opacityOf(page, `${prefix}-${endpoint}-increase`)).toBe(1);
  await increase.click();
  await expectEndpoint(page, [prefix, endpoint], original + step, step / 10000);
  await decrease.click();
  await expectEndpoint(page, [prefix, endpoint], original, step / 10000);
  await field.click();
  await utils.moveToElement(page.locator('header'));
  expect(await opacityOf(page, `${prefix}-${endpoint}-increase`)).toBe(1);
  await page.keyboard.press('ArrowUp');
  await expectEndpoint(page, [prefix, endpoint], original + step, step / 10000);
  await page.keyboard.press('ArrowDown');
  await expectEndpoint(page, [prefix, endpoint], original, step / 10000);
  expect(await other.getAttribute('title')).toBe(unchanged);
}

test.describe('Display range number steppers', () => {
  test('uses underlined manual window fields and reversible negative and fractional endpoint steps', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    await openRanges({ page, utils, layerDisplay }, [0, 1]);
    await control(page, 'base-image-contrast').click();
    const manual = page.locator('.v-menu.v-overlay--active .manual-inputs');
    await expect(manual).toBeVisible();
    await waitForTransitions(manual);
    const fields = manual.locator('.v-field');
    await expect(fields).toHaveCount(2);
    for (const field of await fields.all()) {
      await expect(field).toHaveClass(/\bv-field--variant-underlined\b/);
      expect(
        await field.evaluate(
          (element) => getComputedStyle(element).backgroundColor
        )
      ).toBe('rgba(0, 0, 0, 0)');
    }
    const values = manual.locator('input');
    await setValueVueInput(values.nth(0), '600');
    await setValueVueInput(values.nth(1), '-200');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expectEndpoint(page, ['base-image-range', 'min'], -500, 1e-10);
    await expectEndpoint(page, ['base-image-range', 'max'], 100, 1e-10);
    await reversibleStep({ page, utils }, ['base-image-range', 'min'], 1);
    await reversibleStep({ page, utils }, ['layer-range', 'max'], 0.01);
  });

  test('steps tiny floating image ranges without rounding their values or applying incomplete drafts', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    await openRanges({ page, utils, layerDisplay }, [1e-9, 9e-9]);
    await reversibleStep({ page, utils }, ['layer-range', 'min'], 1e-11);
    await reversibleStep({ page, utils }, ['layer-range', 'max'], 1e-11);
    const minimum = input(page, 'layer-range', 'min');
    const applied = await minimum.getAttribute('title');
    const maximum = await input(page, 'layer-range', 'max').getAttribute(
      'title'
    );
    await setValueVueInput(minimum, '1e-');
    await expect(control(page, 'layer-range-status')).toHaveText(
      'Min and Max must be finite numbers.'
    );
    await expect(control(page, 'layer-range-min-increase')).toBeDisabled();
    await expect(control(page, 'layer-range-min-decrease')).toBeDisabled();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(minimum).toHaveValue('1e-');
    expect(await minimum.getAttribute('title')).toBe(applied);
    expect(await input(page, 'layer-range', 'max').getAttribute('title')).toBe(
      maximum
    );
  });

  test('steps large off-image endpoints with buttons and keyboard for base and overlay ranges', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    await openRanges({ page, utils, layerDisplay }, [0, 1]);
    const minimum = 1e16;
    const maximum = minimum + 100;
    for (const prefix of ['base-image-range', 'layer-range']) {
      for (const endpoint of ['min', 'max']) {
        await setValueVueInput(input(page, prefix, 'max'), String(maximum));
        await setValueVueInput(input(page, prefix, 'min'), String(minimum));
        await page.locator('header').click();
        await reversibleStep({ page, utils }, [prefix, endpoint], 4);
      }
    }
  });

  test('shows tiny Contrast values and preserves full precision when editing the other manual field', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    await openRanges({ page, utils, layerDisplay }, [0, 1]);
    await setValueVueInput(input(page, 'base-image-range', 'min'), '0');
    await setValueVueInput(input(page, 'base-image-range', 'max'), '0.0001');
    await control(page, 'base-image-contrast').click();
    const manual = page.locator('.v-menu.v-overlay--active .manual-inputs');
    await expect(manual).toBeVisible();
    const fields = manual.locator('input');
    await expect(fields.nth(0)).toHaveValue('0.0001');
    await expect(fields.nth(1)).toHaveValue('0.00005');
    await setValueVueInput(fields.nth(0), '1.23456789e-8');
    await setValueVueInput(fields.nth(1), '2.34567891e-8');
    await page.keyboard.press('Escape');
    await expectEndpoint(
      page,
      ['base-image-range', 'min'],
      1.728394965e-8,
      1e-22
    );
    await expectEndpoint(
      page,
      ['base-image-range', 'max'],
      2.962962855e-8,
      1e-22
    );
    await control(page, 'base-image-contrast').click();
    await expect(fields.nth(0)).toHaveValue('1.235e-8');
    await expect(fields.nth(1)).toHaveValue('2.346e-8');
    await fields.nth(0).click();
    await expect(fields.nth(0)).toHaveValue('1.23456789e-8');
    await fields.nth(1).click();
    await expect(fields.nth(1)).toHaveValue('2.34567891e-8');
    await page.keyboard.press('Escape');
    await expectEndpoint(
      page,
      ['base-image-range', 'min'],
      1.728394965e-8,
      1e-22
    );
    await expectEndpoint(
      page,
      ['base-image-range', 'max'],
      2.962962855e-8,
      1e-22
    );
  });
});
