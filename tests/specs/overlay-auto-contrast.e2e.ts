import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  makeTempDir,
  openVolViewPage,
  selectLayout,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeManifestToFile,
  writeMetaImage,
} from './utils';

const layer = () => $('section[aria-label="contrast-target.nrrd"]');
const other = () => $('section[aria-label="contrast-other.mha"]');
const targetInput = (endpoint: string) =>
  layer().$(`[data-testid="layer-range-${endpoint}"] input`);
const visibility = () => layer().$('[data-testid="layer-visibility"]');

const appliedRange = async () =>
  Promise.all(
    ['min', 'max'].map(async (endpoint) =>
      Number(await targetInput(endpoint).getAttribute('title'))
    )
  );

const pixels = () =>
  capture2DViewScreenshotMetrics('overlay-auto-contrast.png');

async function openContrast() {
  const trigger = layer().$('[data-testid="layer-contrast"]');
  await trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
  await trigger.click();
  await $('[data-testid="layer-contrast-menu"]').waitForStable();
}

async function chooseContrast(option: string) {
  await openContrast();
  const item = $(`[data-testid="layer-contrast-${option}"]`);
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();
  await expect($('[data-testid="layer-contrast-menu"]')).not.toBeDisplayed();
}

async function unrelatedSettings() {
  return {
    baseMin: await $('[data-testid="base-image-range-min"] input').getAttribute(
      'title'
    ),
    baseMax: await $('[data-testid="base-image-range-max"] input').getAttribute(
      'title'
    ),
    basePalette: await $('[data-testid="base-image-colormap"]').getText(),
    palette: await layer().$('[data-testid="layer-colormap"]').getText(),
    opacity: await layer()
      .$('[data-testid="layer-opacity-slider"] input')
      .getValue(),
    transparent: await layer()
      .$('[data-testid="layer-transparent-background"] input')
      .isSelected(),
    otherMin: await other()
      .$('[data-testid="layer-range-min"] input')
      .getAttribute('title'),
    otherMax: await other()
      .$('[data-testid="layer-range-max"] input')
      .getAttribute('title'),
    otherPalette: await other().$('[data-testid="layer-colormap"]').getText(),
    otherOpacity: await other()
      .$('[data-testid="layer-opacity-slider"] input')
      .getValue(),
  };
}

async function openContrastFixture() {
  const dir = makeTempDir('overlay-contrast');
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
  const base = writeMetaImage('contrast-base.mha', { size: 32, step: 17 });
  const second = writeMetaImage('contrast-other.mha', { size: 32, step: 29 });
  await writeManifestToFile(
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
  await openVolViewPage('overlay-auto-contrast.json');
  await $(`.image-list-card*=${base}`)
    .$('[data-testid="dataset-menu-button"]')
    .click();
  await $('.v-list-item*=Show in all views').waitForClickable();
  await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
  await $('.v-list-item*=Show in all views').click();
  await browser.keys('Escape');
  await volViewPage.renderingModuleTab.click();
  await $('[data-testid="volume-rendering-toggle"]').click();
  await waitForModuleTransitions();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
  await expect(targetInput('min')).toHaveAttribute('title', '-2000');
}

describe('Overlay automatic contrast', () => {
  it('shows contrast choices between the range inputs and applies the full range', async () => {
    await openContrastFixture();
    const trigger = layer().$('[data-testid="layer-contrast"]');
    await expect(trigger.$('.mdi-circle-half-full')).toExist();
    await expect(trigger.$('.mdi-menu-down')).toExist();
    const minX = (await targetInput('min').getLocation()).x;
    const maxX = (await targetInput('max').getLocation()).x;
    const triggerX = (await trigger.getLocation()).x;
    expect(triggerX).toBeGreaterThan(minX);
    expect(triggerX).toBeLessThan(maxX);
    const unchanged = await unrelatedSettings();
    await openContrast();
    expect(await appliedRange()).toEqual([-2000, -1000]);
    const menu = $('[data-testid="layer-contrast-menu"]');
    await expect(menu).toHaveText(
      'Full Range\nLow Contrast\nMedium Contrast\nHigh Contrast'
    );
    await browser.saveScreenshot(
      join(TEMP_DIR, 'overlay-contrast-controls.png')
    );
    await expect(menu.$('input')).not.toExist();
    await expect(menu.$('label=Bones')).not.toExist();
    await $('[data-testid="layer-contrast-FullRange"]').click();
    await expect(targetInput('min')).toHaveAttribute('title', '0');
    await expect(targetInput('max')).toHaveAttribute('title', '1000');
    expect(await unrelatedSettings()).toEqual(unchanged);
  });

  it('uses its resampled histogram for progressively narrower contrast in every slice', async () => {
    await openContrastFixture();
    const unchanged = await unrelatedSettings();
    await chooseContrast('FullRange');
    const widths: number[] = [];
    for (const choice of ['LowContrast', 'MediumContrast', 'HighContrast']) {
      await $('header').moveTo();
      const before = await pixels();
      await chooseContrast(choice);
      const [min, max] = await appliedRange();
      // Resampling adds over 5% zero padding; source percentiles start above 200.
      expect(min).toBe(0);
      expect(max).toBeLessThanOrEqual(1000);
      expect(max).toBeGreaterThan(min);
      widths.push(max - min);
      await $('header').moveTo();
      await browser.waitUntil(
        async () => {
          const after = await pixels();
          return (
            after.length === 3 &&
            after.every((view, i) => view.checksum !== before[i].checksum)
          );
        },
        {
          timeoutMsg:
            'Expected overlay contrast to change every slice rendering',
        }
      );
      expect(await unrelatedSettings()).toEqual(unchanged);
    }
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  it('resets edited ranges and invalid drafts without changing other display settings', async () => {
    await openContrastFixture();
    const unchanged = await unrelatedSettings();
    await chooseContrast('FullRange');
    await setValueVueInput(targetInput('min'), '-2000');
    await setValueVueInput(targetInput('max'), '-1000');
    await browser.keys('Enter');
    await chooseContrast('FullRange');
    expect(await appliedRange()).toEqual([0, 1000]);
    await setValueVueInput(targetInput('min'), '-');
    await browser.keys('Enter');
    await expect(
      layer().$('[data-testid="layer-range-status"]')
    ).toBeDisplayed();
    await chooseContrast('FullRange');
    await expect(targetInput('min')).toHaveValue('0');
    await expect(targetInput('max')).toHaveValue('1000');
    await expect(layer().$('[data-testid="layer-range-status"]')).not.toExist();
    expect(await unrelatedSettings()).toEqual(unchanged);
  });

  it('hides and restores the overlay in every slice without changing display settings', async () => {
    await openContrastFixture();
    const unchanged = await unrelatedSettings();
    await chooseContrast('FullRange');
    await expect(visibility()).toHaveText(expect.stringContaining('HIDE'));
    expect((await visibility().getLocation()).x).toBeLessThan(
      (await layer().$('[data-testid="layer-colormap"]').getLocation()).x
    );
    expect((await visibility().getCSSProperty('border-radius')).value).toBe(
      (
        await layer()
          .$('[data-testid="layer-contrast"]')
          .getCSSProperty('border-radius')
      ).value
    );
    await expect(visibility().$('.mdi-eye')).toExist();
    await $('header').moveTo();
    const shown = await pixels();
    await visibility().scrollIntoView({ block: 'center', behavior: 'instant' });
    await visibility().click();
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await expect(visibility().$('.mdi-eye-off')).toExist();
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const hidden = await pixels();
      return (
        hidden.length === 3 &&
        hidden.every((view, i) => view.checksum !== shown[i].checksum)
      );
    });
    expect(await unrelatedSettings()).toEqual(unchanged);
    await visibility().click();
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const restored = await pixels();
      return (
        restored.length === 3 &&
        restored.every((view, i) => view.checksum === shown[i].checksum)
      );
    });
    expect(await unrelatedSettings()).toEqual(unchanged);
  });

  it('preserves hidden overlay settings through layout changes and a saved session', async () => {
    await openContrastFixture();
    const unchanged = await unrelatedSettings();
    await chooseContrast('FullRange');
    await visibility().scrollIntoView({ block: 'center', behavior: 'instant' });
    await visibility().click();
    await selectLayout('Axial Only', 1, false);
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    expect(await unrelatedSettings()).toEqual(unchanged);
    const saved = await volViewPage.saveSession();
    await waitForDownload(join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await openVolViewPage(saved);
    await volViewPage.renderingModuleTab.click();
    await visibility().scrollIntoView({ block: 'center', behavior: 'instant' });
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await selectLayout('Four Up', 3, true);
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    expect(await unrelatedSettings()).toEqual(unchanged);
    await $('header').moveTo();
    const hidden = await pixels();
    await visibility().click();
    await expect(visibility()).toHaveText(expect.stringContaining('HIDE'));
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const restored = await pixels();
      return (
        restored.length === 3 &&
        restored.every((view, i) => view.checksum !== hidden[i].checksum)
      );
    });
    expect(await unrelatedSettings()).toEqual(unchanged);
  });
});
