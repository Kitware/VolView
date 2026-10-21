import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  captureViewPixels,
  makeTempDir,
  openVolViewPage,
  selectLayout,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeManifestToFile,
  writeMetaImage,
} from './utils';

const field = (endpoint: 'min' | 'max') =>
  $(`[data-testid="base-image-range-${endpoint}"] input`);
const handle = (endpoint: 'min' | 'max' | 'center') =>
  $(`[data-testid="base-image-range-${endpoint}-handle"]`);

async function openBase(withOverlay = false) {
  const directory = makeTempDir('base-display');
  const header = [
    'NRRD0005',
    'type: short',
    'dimension: 3',
    'sizes: 16 16 16',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ].join('\n');
  // Every orthogonal plane contains a ramp, including negative CT values.
  const voxels = Array.from({ length: 4096 }, (_, index) => {
    const x = index % 16;
    const y = Math.floor(index / 16) % 16;
    const z = Math.floor(index / 256);
    return -1000 + ((x + y + z) % 16) * 100;
  }).join(' ');
  writeFileSync(join(directory, 'base.nrrd'), `${header}\n\n${voxels}`);
  await writeManifestToFile(
    {
      windowing: { width: 1500, level: -250 },
      io: { layerExtension: 'layer' },
    },
    'base-display-config.json'
  );
  const overlay = withOverlay ? writeMetaImage('base.layer.mha') : undefined;
  await volViewPage.open(
    `?urls=[tmp/base-display-config.json,tmp/base-display/base.nrrd${
      overlay ? `,tmp/${overlay}` : ''
    }]`
  );
  await volViewPage.waitForViews();
  await selectLayout('Four Up', 3, true);
  await volViewPage.renderingModuleTab.click();
  for (const title of ['Color Presets', 'Cinematic Rendering']) {
    const section = $(`.v-expansion-panel-title*=${title}`);
    if ((await section.getAttribute('aria-expanded')) === 'true')
      await section.click();
  }
  await waitForModuleTransitions();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
  await field('min').scrollIntoView({ block: 'center', behavior: 'instant' });
  await expect(field('min')).toBeEnabled();
}

async function expectRange(minimum: number, maximum: number) {
  await expect(field('min')).toHaveAttribute('title', String(minimum));
  await expect(field('max')).toHaveAttribute('title', String(maximum));
  const label = `W/L: ${(maximum - minimum).toFixed(2)} / ${(
    (maximum + minimum) /
    2
  ).toFixed(2)}`;
  for (const view of await volViewPage.getViews2D())
    await expect(view).toHaveText(expect.stringContaining(label));
}

async function setRange(minimum: string, maximum: string) {
  await setValueVueInput(field('min'), minimum);
  await setValueVueInput(field('max'), maximum);
  await browser.keys('Enter');
}

const capture = () =>
  capture2DViewScreenshotMetrics('base-display-capture.png');

async function expectViewsChanged(before: Awaited<ReturnType<typeof capture>>) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const after = await capture();
      return (
        after.length === 3 &&
        after.every(
          ({ checksum }, index) => checksum !== before[index].checksum
        )
      );
    },
    { timeoutMsg: 'Expected the base window to change all three slice images' }
  );
}

async function openWindowing() {
  await volViewPage.selectTool('mdi-circle-half-full');
  await $('.v-menu.v-overlay--active .manual-inputs input').waitForDisplayed();
  await $('.v-menu.v-overlay--active .manual-inputs').waitForStable();
}

async function expectRangeMatchesWindowing() {
  const minimum = Number(await field('min').getAttribute('title'));
  const maximum = Number(await field('max').getAttribute('title'));
  await expectRange(minimum, maximum);
  return [minimum, maximum] as const;
}

async function selectBasePalette(title: string) {
  const palette = $('[data-testid="base-image-colormap"]');
  await palette.scrollIntoView({ block: 'center', behavior: 'instant' });
  await palette.click();
  await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
  const option = $(`[role="option"]*=${title}`);
  await option.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  await option.waitForStable();
  await option.click();
  await expect(palette).toHaveText(expect.stringContaining(title));
}

async function obliqueColors() {
  const views = await captureViewPixels(
    '.oblique-grid [data-testid="vtk-view"]',
    40,
    'base-oblique-capture.png'
  );
  return views.map(({ data }) => {
    let colored = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        Math.max(data[i], data[i + 1], data[i + 2]) -
          Math.min(data[i], data[i + 1], data[i + 2]) >
        40
      )
        colored++;
    return colored;
  });
}

describe('Base image display range', () => {
  it('edits a base without overlays and synchronizes presets, keyboard, drag and mouse windowing', async () => {
    await openBase();
    await expect($('[data-testid="base-image-properties"]')).toBeDisplayed();
    await expect($('[data-testid="layer-colormap"]')).not.toExist();
    await expectRange(-1000, 500);
    await $('header').moveTo();
    const original = await capture();
    await setRange('-800', '200');
    await expectRange(-800, 200);
    await expectViewsChanged(original);
    await setRange('50', '200');
    await setValueVueInput(field('min'), '300.000');
    await setValueVueInput(field('max'), '400.000');
    await expectRange(300, 400);
    await expect(field('max')).toBeFocused();
    await expect(field('max')).toHaveValue('400.000');
    await openWindowing();
    const manual = $$('.v-overlay--active .manual-inputs input');
    await expect(manual[0]).toHaveValue('100');
    await expect(manual[1]).toHaveValue('350');
    await setValueVueInput(manual[0], '600');
    await setValueVueInput(manual[1], '-200');
    await browser.keys('Enter');
    await expectRange(-500, 100);
    await expect(field('min')).toHaveValue('-500');
    await expect(field('max')).toHaveValue('100');
    await expect($('[data-testid="base-image-range-status"]')).not.toExist();
    await browser.keys('Escape');
    await setValueVueInput(field('min'), '-');
    await openWindowing();
    await $('.v-menu.v-overlay--active').$('label=Air').click();
    await expectRange(-926, 74);
    await expect(field('min')).toHaveValue('-');
    await browser.keys('Escape');
    await setValueVueInput(field('min'), '0.1');
    await field('max').click();
    expect(Number(await field('min').getAttribute('title'))).toBeCloseTo(
      0.1,
      12
    );
    await openWindowing();
    await $('.v-menu.v-overlay--active').$('label=Air').click();
    await expectRange(-926, 74);
    await expect(field('min')).toHaveValue('-926');
    await browser.keys('Escape');
    await field('min').scrollIntoView({ block: 'center', behavior: 'instant' });
    const gradient = await $(
      '[data-testid="base-image-range-bar"] .color-map-swatch'
    ).getAttribute('style');
    if (!gradient) throw new Error('Expected a base grayscale gradient');
    expect(gradient).toContain('linear-gradient(');
    await setRange('-800', '200');
    await handle('max').execute((element) => element.focus());
    await browser.keys('ArrowDown');
    await expectRange(-800, 185);
    await setRange('180', '185');
    await handle('min').execute((element) => element.focus());
    await expect(handle('min')).toBeFocused();
    await browser.keys('ArrowRight');
    for (const endpoint of ['min', 'max', 'center'] as const)
      await expect(handle(endpoint)).toBeEnabled();
    const narrow = await expectRangeMatchesWindowing();
    expect(narrow[0]).toBeGreaterThan(184);
    expect(narrow[0]).toBeLessThan(narrow[1]);
    expect(narrow[1]).toBe(185);
    await setRange('-995', '185');
    await handle('min').execute((element) => element.focus());
    await browser.keys('ArrowLeft');
    await expectRange(-1000, 185);
    await setRange('-800', '-795');
    await handle('max').execute((element) => element.focus());
    await expect(handle('max')).toBeFocused();
    await browser.keys('ArrowDown');
    const narrowAtMin = await expectRangeMatchesWindowing();
    expect(narrowAtMin[0]).toBe(-800);
    expect(narrowAtMin[1]).toBeGreaterThan(-800);
    expect(narrowAtMin[1]).toBeLessThan(-799);
    await setRange('-800', '50');
    const center = handle('center');
    const location = await center.getLocation();
    const size = await center.getSize();
    const x = Math.round(location.x + size.width / 2);
    const y = Math.round(location.y + size.height / 2);
    await browser
      .action('pointer')
      .move({ x, y })
      .down()
      .move({ x: x + 15, y })
      .up()
      .perform();
    const dragged = await expectRangeMatchesWindowing();
    expect(dragged[0]).toBeGreaterThan(-800);
    expect(dragged[1] - dragged[0]).toBeCloseTo(850, 8);
    await expect(
      $('[data-testid="base-image-range-bar"] .color-map-swatch')
    ).not.toHaveAttribute('style', gradient);

    await setRange('100', '200');
    await setValueVueInput(field('max'), '99');
    await browser.keys('Enter');
    await expect($('[data-testid="base-image-range-status"]')).toHaveText(
      'Min must be less than Max.'
    );
    await expectRange(100, 200);
    await setValueVueInput(field('max'), '200');
    await browser.keys('Enter');
    await setRange('-800', '200');
    const view = (await volViewPage.getViews2D())[0];
    const canvas = await view.$('canvas');
    const origin = await canvas.getLocation();
    const bounds = await canvas.getSize();
    const cx = Math.round(origin.x + bounds.width / 2);
    const cy = Math.round(origin.y + bounds.height / 2);
    await browser
      .action('pointer')
      .move({ x: cx, y: cy })
      .down()
      .move({ x: cx + 30, y: cy + 20 })
      .up()
      .perform();
    await browser.waitUntil(
      async () => Number(await field('min').getAttribute('title')) !== -800
    );
    const mouseRange = await expectRangeMatchesWindowing();
    expect(mouseRange).not.toEqual([-800, 200]);
  });

  it('colors the base slices independently of windowing and volume rendering', async () => {
    await openBase();
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('Grayscale')
    );
    await expect($('[data-testid="layer-colormap"]')).not.toExist();
    await $('header').moveTo();
    const before = await capture();
    const volumeSettings = await $$('.mapping-range-editor input').map(
      (input) => input.getValue()
    );
    await selectBasePalette('DICOM Hot Iron');
    await expectRange(-1000, 500);
    await expectViewsChanged(before);
    await browser.waitUntil(async () =>
      (await capture()).every(({ colored }) => colored > 1000)
    );
    expect(
      await $$('.mapping-range-editor input').map((input) => input.getValue())
    ).toEqual(volumeSettings);
    await $('[data-testid="base-image-contrast"]').click();
    await $('.v-menu.v-overlay--active .v-card').waitForStable();
    await $('.v-menu.v-overlay--active').$('label=Air').click();
    await browser.keys('Escape');
    await expectRange(-926, 74);
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('DICOM Hot Iron')
    );
  });

  it('uses local Contrast presets to recover an offscreen window without snapping a drag', async () => {
    await openBase();
    const volume = await volViewPage.getView3D();
    await volume!.click();
    const volumeBorder = () =>
      volume!.execute(
        (element) =>
          getComputedStyle(element.closest('.grid-item')!).borderColor
      );
    expect(await volumeBorder()).toBe('rgb(60, 179, 113)');
    const contrast = $('[data-testid="base-image-contrast"]');
    await expect(contrast).toBeDisplayed();
    await expect(contrast.$('.mdi-menu-down')).toExist();
    const minimumRect = await field('min').getLocation();
    const maximumRect = await field('max').getLocation();
    const contrastRect = await contrast.getLocation();
    expect(contrastRect.x).toBeGreaterThan(minimumRect.x);
    expect(contrastRect.x).toBeLessThan(maximumRect.x);
    await contrast.click();
    await $('.v-menu.v-overlay--active .v-card').waitForStable();
    await expectRange(-1000, 500);
    const popup = $('.v-menu.v-overlay--active');
    await popup.$('label=Lungs').click();
    await expectRange(-1350, 150);
    expect(await volumeBorder()).toBe('rgb(60, 179, 113)');
    await browser.keys('Escape');
    await expect(handle('min').$('.handle-grip')).toHaveAttribute(
      'data-direction',
      'left'
    );
    const thumb = handle('min');
    const location = await thumb.getLocation();
    const size = await thumb.getSize();
    const x = Math.round(location.x + size.width / 2);
    const y = Math.round(location.y + size.height / 2);
    const trackWidth = (
      await $('[data-testid="base-image-range-bar"]').getSize()
    ).width;
    await browser
      .action('pointer')
      .move({ x, y })
      .down()
      .move({ x: x + 2, y })
      .up()
      .perform();
    const dragged = await expectRangeMatchesWindowing();
    expect(dragged[0]).toBeCloseTo(-1350 + (2 / trackWidth) * 1500, 8);
    expect(dragged[0]).toBeLessThan(-1000);
    expect(dragged[1]).toBeCloseTo(150, 8);

    await contrast.click();
    await $('.v-menu.v-overlay--active .v-card').waitForStable();
    expect(await expectRangeMatchesWindowing()).toEqual(dragged);
    const manual = $$('.v-menu.v-overlay--active .manual-inputs input');
    await $('.v-menu.v-overlay--active .manual-inputs').waitForStable();
    await setValueVueInput(manual[0], '100');
    await setValueVueInput(manual[1], '-2000');
    await browser.keys('Enter');
    await expectRange(-2050, -1950);
    await browser.keys('Escape');
    await expect(handle('center')).toBeEnabled();
    await expect(handle('center').$('.handle-grip')).toHaveAttribute(
      'data-direction',
      'left'
    );
    await contrast.click();
    await $('.v-menu.v-overlay--active .v-card').waitForStable();
    await expectRange(-2050, -1950);
    await $('.v-menu.v-overlay--active').$('label=Full Range').click();
    await expectRange(-1000, 500);
    await browser.keys('Escape');
    await expect(field('min')).toHaveValue('-1000');
    await expect(field('max')).toHaveValue('500');
    for (const draft of ['-', '']) {
      await setValueVueInput(field('min'), draft);
      await browser.keys('Enter');
      await expect(
        $('[data-testid="base-image-range-status"]')
      ).toBeDisplayed();
      await contrast.click();
      await $('.v-menu.v-overlay--active .v-card').waitForStable();
      await $('.v-menu.v-overlay--active').$('label=Full Range').click();
      await browser.keys('Escape');
      await expect(field('min')).toHaveValue('-1000');
      await expect(field('max')).toHaveValue('500');
      await expect($('[data-testid="base-image-range-status"]')).not.toExist();
    }
  });

  it('shares base palette, range, visibility and reset with oblique views', async () => {
    await openBase();
    await selectBasePalette('DICOM Hot Iron');
    await setRange('-800', '200');
    await volViewPage.layoutButton.click();
    await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
    await $('.v-list-item-title=Oblique').click();
    await $('.oblique-grid').waitForDisplayed();
    await $('.oblique-grid').waitForStable();
    await expect(field('min')).toBeEnabled();
    await expectRange(-800, 200);
    for (const view of await $$(
      '.oblique-grid > .d-flex:not(:nth-child(2)) [data-testid="vtk-view"]'
    ))
      await expect(view).toHaveText(
        expect.stringContaining('W/L: 1000.00 / -300.00')
      );
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const colors = await obliqueColors();
      return colors.length === 4 && colors.every((count) => count > 1000);
    });
    const colored = await obliqueColors();

    const expectUncolored = async () => {
      await $('header').moveTo();
      await browser.waitUntil(async () => {
        const colors = await obliqueColors();
        return (
          colors.length === 4 &&
          colors.every((count, i) => count < colored[i] / 3)
        );
      });
    };

    const expectColored = async () => {
      await $('header').moveTo();
      await browser.waitUntil(async () => {
        const colors = await obliqueColors();
        return (
          colors.length === 4 &&
          colors.every((count, i) => count > colored[i] / 2)
        );
      });
    };

    await selectBasePalette('Grayscale');
    await expectUncolored();
    await selectBasePalette('DICOM Hot Iron');
    await expectColored();
    await setRange('-2000', '-1000');
    await expectRange(-2000, -1000);
    await expectUncolored();
    await $('[data-testid="base-image-contrast"]').click();
    await $('.v-menu.v-overlay--active .v-card').waitForStable();
    await $('.v-menu.v-overlay--active').$('label=Full Range').click();
    await browser.keys('Escape');
    await expectRange(-1000, 500);
    await expectColored();
    const visibility = $('[data-testid="base-image-visibility"]');
    await visibility.click();
    await expectUncolored();
    await selectLayout('Four Up', 3, true);
    await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
    await expectRange(-1000, 500);
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('DICOM Hot Iron')
    );
    await volViewPage.layoutButton.click();
    await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
    await $('.v-list-item-title=Oblique').click();
    await $('.oblique-grid').waitForDisplayed();
    await $('.oblique-grid').waitForStable();
    await expectUncolored();
    await visibility.click();
    await expectColored();
    await setRange('-800', '200');
    await $('[data-testid="control-button-Reset Views"]').click();
    await expectRange(-1000, 500);
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('Grayscale')
    );
    await expect(visibility).toHaveText(expect.stringContaining('HIDE'));
    await expectUncolored();
  });

  it('preserves the base window through layouts and a saved session without changing overlay settings', async () => {
    await openBase(true);
    const overlayMin = $('[data-testid="layer-range-min"] input');
    const overlayMax = $('[data-testid="layer-range-max"] input');
    await expect(overlayMin).toBeEnabled();

    const overlaySettings = async () => ({
      min: await overlayMin.getAttribute('title'),
      max: await overlayMax.getAttribute('title'),
      palette: await $('[data-testid="layer-colormap"]').getText(),
      opacity: await $('[data-testid="layer-opacity-slider"] input').getValue(),
      transparent: await $(
        '[data-testid="layer-transparent-background"] input'
      ).isSelected(),
    });

    const initialOverlay = await overlaySettings();
    await selectBasePalette('Viridis');
    await setRange('-800', '200');
    await expectRange(-800, 200);
    expect(await overlaySettings()).toEqual(initialOverlay);
    const visibility = () => $('[data-testid="base-image-visibility"]');
    await expect(visibility()).toHaveText(expect.stringContaining('HIDE'));
    expect((await visibility().getLocation()).x).toBeLessThan(
      (await $('[data-testid="base-image-colormap"]').getLocation()).x
    );
    expect((await visibility().getCSSProperty('border-radius')).value).toBe(
      (
        await $('[data-testid="base-image-contrast"]').getCSSProperty(
          'border-radius'
        )
      ).value
    );
    await $('header').moveTo();
    const shown = await capture();
    await visibility().click();
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const hidden = await capture();
      return (
        hidden.length === 3 &&
        hidden.every(
          (view, i) =>
            view.colored > 1000 && view.checksum !== shown[i].checksum
        )
      );
    });
    await expectRange(-800, 200);
    expect(await overlaySettings()).toEqual(initialOverlay);
    await visibility().click();
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const restored = await capture();
      return (
        restored.length === 3 &&
        restored.every((view, i) => view.checksum === shown[i].checksum)
      );
    });
    await visibility().click();
    await selectLayout('3D Only', 0, true);
    await expect(field('min')).toBeDisplayed();
    await expect(visibility()).toBeDisabled();
    await expect(field('min')).toBeDisabled();
    await expect(field('max')).toBeDisabled();
    await expect($('[data-testid="base-image-contrast"]')).toBeDisabled();
    await expect($('[data-testid="base-image-colormap"] input')).toBeDisabled();
    for (const endpoint of ['min', 'max', 'center'] as const)
      await expect(handle(endpoint)).toHaveAttribute('tabindex', '-1');
    await $('[data-testid="base-image-properties"] .ms-4').moveTo();
    await expect(
      $('.v-tooltip.v-overlay--active .v-overlay__content')
    ).toHaveText(
      'Open a 2D or oblique view showing this image to adjust window/level.'
    );
    await selectLayout('Axial Only', 1, false);
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await expectRange(-800, 200);
    await expect(field('min')).toBeEnabled();
    const saved = await volViewPage.saveSession();
    await waitForDownload(join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await openVolViewPage(saved);
    await volViewPage.renderingModuleTab.click();
    await field('min').scrollIntoView({ block: 'center', behavior: 'instant' });
    await expectRange(-800, 200);
    await selectLayout('Four Up', 3, true);
    await expect(visibility()).toHaveText(expect.stringContaining('SHOW'));
    await expectRange(-800, 200);
    expect(await overlaySettings()).toEqual(initialOverlay);
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('Viridis')
    );
    await $('header').moveTo();
    const hidden = await capture();
    await visibility().click();
    await expect(visibility()).toHaveText(expect.stringContaining('HIDE'));
    await $('header').moveTo();
    await expectViewsChanged(hidden);
    expect(await overlaySettings()).toEqual(initialOverlay);
  });
});
