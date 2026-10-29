import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setValueVueInput } from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  openLayerDisplayControls,
} from './layerDisplayTestUtils';
import { makeTempDir, openVolViewPage, writeManifestToFile } from './utils';

async function openRanges(overlayRange: [number, number]) {
  const directory = makeTempDir('number-steppers');
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
  await writeManifestToFile(
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
  await openVolViewPage('number-steppers.json');
  await $('.image-list-card*=steppers-0.nrrd')
    .$('[data-testid="dataset-menu-button"]')
    .click();
  const show = $('.v-list-item*=Show in all views');
  await show.waitForClickable();
  await show.click();
  await browser.keys('Escape');
  await openLayerDisplayControls();
}

const control = (id: string) => $(`[data-testid="${id}"]`);
const input = (prefix: string, endpoint: string) =>
  control(`${prefix}-${endpoint}`).$('input');

async function expectEndpoint(
  prefix: string,
  endpoint: string,
  expected: number,
  tolerance: number
) {
  await browser.waitUntil(
    async () =>
      Math.abs(
        Number(await input(prefix, endpoint).getAttribute('title')) - expected
      ) < tolerance
  );
}

async function reversibleStep(prefix: string, endpoint: string, step: number) {
  const field = input(prefix, endpoint);
  const other = input(prefix, endpoint === 'min' ? 'max' : 'min');
  const original = Number(await field.getAttribute('title'));
  const unchanged = await other.getAttribute('title');
  await field.scrollIntoView({ block: 'center', behavior: 'instant' });
  await control(`${prefix}-${endpoint}`).moveTo();
  const increase = control(`${prefix}-${endpoint}-increase`);
  const decrease = control(`${prefix}-${endpoint}-decrease`);
  expect(
    Number((await increase.parentElement().getCSSProperty('opacity')).value)
  ).toBe(1);
  await increase.click();
  await expectEndpoint(prefix, endpoint, original + step, step / 10000);
  await decrease.click();
  await expectEndpoint(prefix, endpoint, original, step / 10000);
  await field.click();
  await $('header').moveTo();
  expect(
    Number((await increase.parentElement().getCSSProperty('opacity')).value)
  ).toBe(1);
  await browser.keys('ArrowUp');
  await expectEndpoint(prefix, endpoint, original + step, step / 10000);
  await browser.keys('ArrowDown');
  await expectEndpoint(prefix, endpoint, original, step / 10000);
  expect(await other.getAttribute('title')).toBe(unchanged);
}

describe('Display range number steppers', () => {
  it('uses underlined manual window fields and reversible negative and fractional endpoint steps', async () => {
    await openRanges([0, 1]);
    await control('base-image-contrast').click();
    const manual = $('.v-menu.v-overlay--active .manual-inputs');
    await manual.waitForDisplayed();
    await manual.waitForStable();
    const fields = await manual.$$('.v-field');
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      await expect(field).toHaveElementClass('v-field--variant-underlined');
      expect((await field.getCSSProperty('background-color')).value).toBe(
        'rgba(0,0,0,0)'
      );
    }
    const values = await manual.$$('input');
    await setValueVueInput(values[0], '600');
    await setValueVueInput(values[1], '-200');
    await browser.keys('Enter');
    await browser.keys('Escape');
    await expectEndpoint('base-image-range', 'min', -500, 1e-10);
    await expectEndpoint('base-image-range', 'max', 100, 1e-10);
    await reversibleStep('base-image-range', 'min', 1);
    await reversibleStep('layer-range', 'max', 0.01);
  });

  it('steps tiny floating image ranges without rounding their values or applying incomplete drafts', async () => {
    await openRanges([1e-9, 9e-9]);
    await reversibleStep('layer-range', 'min', 1e-11);
    await reversibleStep('layer-range', 'max', 1e-11);
    const minimum = input('layer-range', 'min');
    const applied = await minimum.getAttribute('title');
    const maximum = await input('layer-range', 'max').getAttribute('title');
    await setValueVueInput(minimum, '1e-');
    await expect(control('layer-range-status')).toHaveText(
      'Min and Max must be finite numbers.'
    );
    await expect(control('layer-range-min-increase')).toBeDisabled();
    await expect(control('layer-range-min-decrease')).toBeDisabled();
    await browser.keys(['ArrowUp', 'ArrowDown']);
    await expect(minimum).toHaveValue('1e-');
    expect(await minimum.getAttribute('title')).toBe(applied);
    expect(await input('layer-range', 'max').getAttribute('title')).toBe(
      maximum
    );
  });

  it('steps large off-image endpoints with buttons and keyboard for base and overlay ranges', async () => {
    await openRanges([0, 1]);
    const minimum = 1e16;
    const maximum = minimum + 100;
    for (const prefix of ['base-image-range', 'layer-range']) {
      for (const endpoint of ['min', 'max']) {
        await setValueVueInput(input(prefix, 'max'), String(maximum));
        await setValueVueInput(input(prefix, 'min'), String(minimum));
        await $('header').click();
        await reversibleStep(prefix, endpoint, 4);
      }
    }
  });

  it('shows tiny Contrast values and preserves full precision when editing the other manual field', async () => {
    await openRanges([0, 1]);
    await setValueVueInput(input('base-image-range', 'min'), '0');
    await setValueVueInput(input('base-image-range', 'max'), '0.0001');
    await control('base-image-contrast').click();
    const manual = $('.v-menu.v-overlay--active .manual-inputs');
    await manual.waitForDisplayed();
    const fields = await manual.$$('input');
    await expect(fields[0]).toHaveValue('0.0001');
    await expect(fields[1]).toHaveValue('0.00005');
    await setValueVueInput(fields[0], '1.23456789e-8');
    await setValueVueInput(fields[1], '2.34567891e-8');
    await browser.keys('Escape');
    await expectEndpoint('base-image-range', 'min', 1.728394965e-8, 1e-22);
    await expectEndpoint('base-image-range', 'max', 2.962962855e-8, 1e-22);
    await control('base-image-contrast').click();
    await expect(fields[0]).toHaveValue('1.235e-8');
    await expect(fields[1]).toHaveValue('2.346e-8');
    await fields[0].click();
    await expect(fields[0]).toHaveValue('1.23456789e-8');
    await fields[1].click();
    await expect(fields[1]).toHaveValue('2.34567891e-8');
    await browser.keys('Escape');
    await expectEndpoint('base-image-range', 'min', 1.728394965e-8, 1e-22);
    await expectEndpoint('base-image-range', 'max', 2.962962855e-8, 1e-22);
  });
});
