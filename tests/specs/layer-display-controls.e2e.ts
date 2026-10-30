import {
  layeredImageManifest,
  openLayerDisplayControls,
} from './layerDisplayTestUtils';
import * as path from 'path';
import {
  applyTestViewport,
  CONTENT_VIEWPORT,
  TEMP_DIR,
} from '@/wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewPixels,
  capture2DViewScreenshotMetrics,
  selectLayout,
  openVolViewPage,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  writeManifestToFile,
  writeMetaImage,
} from './utils';

const paletteTitles = [
  'Grayscale',
  'Inverted grayscale',
  'DICOM Hot Iron',
  'DICOM PET',
  'DICOM Hot Metal Blue',
  'DICOM Spring',
  'DICOM Winter',
  'Viridis',
  'Cool to Warm',
];

async function expectPaletteOptions() {
  const options = $$('[role="option"]');
  const expected = paletteTitles;
  await expect(options).toBeElementsArrayOfSize(expected.length);
  for (const [index, title] of expected.entries()) {
    const option = options[index];
    await option.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    await expect(option).toHaveText(title);
    await expect(
      option.$('[data-testid="layer-palette-option-swatch"]')
    ).toHaveAttribute('style', expect.stringContaining('linear-gradient('));
  }
}

async function captureViewPixels() {
  return capture2DViewScreenshotMetrics('overlay-capture.png');
}

async function windowingLabels() {
  const views = await volViewPage.getViews2D();
  return views.map(async (view) => {
    const text = await view.getText();
    return text.match(/W\/L: [\d.-]+ \/ [\d.-]+/)?.[0];
  });
}

async function expectAppliedRange(
  min: string,
  max: string,
  displayedMax = max
) {
  await $('h4*=display-overlay.mha').click();
  await expect($('[data-testid="layer-range-min"] input')).toHaveValue(min);
  await expect($('[data-testid="layer-range-max"] input')).toHaveValue(
    displayedMax
  );
  await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
    'title',
    min
  );
  await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
    'title',
    max
  );
}

async function expectDisplaySettings(
  min: string,
  max: string,
  displayedMax = max
) {
  await expectAppliedRange(min, max, displayedMax);
  await expect($('[data-testid="layer-colormap"]')).toHaveText(
    expect.stringContaining('Cool to Warm')
  );
  await expect(
    $('[data-testid="layer-opacity-slider"] [role="slider"]')
  ).toHaveAttribute('aria-valuenow', '0.5');
  await expect(
    $('[data-testid="layer-transparent-background"] input')
  ).not.toBeChecked();
}

async function expectRenderedPixels(
  expected: Awaited<ReturnType<typeof captureViewPixels>>
) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const pixels = await captureViewPixels();
      return (
        pixels.length === expected.length &&
        pixels.every(
          ({ colored, blue, checksum }, index) =>
            colored === expected[index].colored &&
            blue === expected[index].blue &&
            checksum === expected[index].checksum
        )
      );
    },
    {
      timeoutMsg:
        'Expected matching overlay color counts and intensity sum after replacing views or reopening the session',
    }
  );
}

async function openDisplayFixture({
  preset = 'Cool to Warm',
  mappingRange = [-2.75, 100.25],
  opacity = 0.5,
  transparentBackground = false,
  singleSlice = false,
} = {}) {
  const display = { preset, mappingRange, opacity, transparentBackground };
  const base = writeMetaImage('display-base.mha');
  const overlay = writeMetaImage('display-overlay.mha', { step: 29 });
  const manifest = 'display-controls.json';
  await writeManifestToFile(
    {
      ...layeredImageManifest(base, overlay),
      ...(singleSlice
        ? {
            layout: {
              direction: 'row',
              items: [{ type: 'slot', slotIndex: 0 }],
            },
            layoutSlots: ['axial'],
            activeView: 'axial',
            viewByID: {
              axial: {
                id: 'axial',
                type: '2D',
                name: 'Axial',
                dataID: 'base',
                options: { orientation: 'Axial' },
              },
            },
          }
        : {}),
      layerDisplay: {
        'base::overlay': display,
      },
    },
    manifest
  );

  await openVolViewPage(manifest);
  const baseCard = $(`.image-list-card*=${base}`);
  await baseCard.waitForClickable();
  await baseCard.$('[data-testid="dataset-menu-button"]').click();
  const showInAllViews = $('.v-list-item*=Show in all views');
  await showInAllViews.waitForClickable();
  await showInAllViews.click();
  await browser.keys('Escape');
  await openLayerDisplayControls();
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const pixels = await captureViewPixels();
      return (
        pixels.length === (singleSlice ? 1 : 3) &&
        pixels.every(({ colored }) => colored > 1000)
      );
    },
    { timeoutMsg: 'Expected the overlay to render in every 2D view' }
  );
}

async function openEditedDisplayFixture(singleSlice = false) {
  await openDisplayFixture({
    preset: 'DICOM Hot Iron',
    mappingRange: [0, 255],
    opacity: 0.6,
    singleSlice,
  });
  const select = $('[data-testid="layer-colormap"]');
  await select.scrollIntoView({ block: 'center', behavior: 'instant' });
  await select.click();
  const option = $('[role="option"]*=Cool to Warm');
  await option.scrollIntoView({ block: 'center', behavior: 'instant' });
  await option.waitForClickable();
  await option.click();
  await setValueVueInput($('[data-testid="layer-range-min"] input'), '-2.75');
  await setValueVueInput($('[data-testid="layer-range-max"] input'), '100.25');
  await browser.execute(() => {
    document
      .querySelector<HTMLElement>(
        '[data-testid="layer-opacity-slider"] [role="slider"]'
      )!
      .focus();
  });
  await browser.keys('PageDown');
  await expectDisplaySettings('-2.75', '100.25', '100.3');
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const pixels = await captureViewPixels();
      return (
        pixels.length === (singleSlice ? 1 : 3) &&
        pixels.every(({ colored, blue }) => colored > 1000 && blue > 0)
      );
    },
    {
      timeoutMsg: 'Expected the edited Cool to Warm palette in every 2D view',
    }
  );
  const baseWindowing = await windowingLabels();
  expect(baseWindowing.every(Boolean)).toBe(true);
  const appliedPixels = await captureViewPixels();
  return { baseWindowing, appliedPixels };
}

async function convertSlicesToVolumes() {
  const views = await volViewPage.getViews2D();
  const count = await views.length;
  expect(count).toBeGreaterThan(0);
  for (let remaining = count - 1; remaining >= 0; remaining--) {
    const view = (await volViewPage.getViews2D())[0];
    await view.$('.view-type-select').click();
    const volume = $('[role="option"]*=Volume');
    await volume.waitForClickable();
    await volume.click();
    await volViewPage.waitForViewCounts(remaining, true);
  }
}

describe('Overlay display controls', () => {
  // Capture and compare at a compact viewport to limit volume rendering work.
  before(async () => {
    await browser.setViewport({ ...CONTENT_VIEWPORT, height: 400 });
  });
  after(async () => {
    await applyTestViewport(browser);
  });

  for (const { title, preset } of [
    { title: 'missing', preset: undefined },
    { title: 'unknown', preset: 'Unknown palette' },
  ]) {
    it(`uses Hot Iron for a ${title} saved palette`, async () => {
      const base = writeMetaImage(`fallback-${title}-base.mha`);
      const overlay = writeMetaImage(`fallback-${title}-overlay.mha`, {
        step: 29,
      });
      const manifest = `fallback-${title}.json`;
      await writeManifestToFile(
        {
          ...layeredImageManifest(base, overlay),
          layerDisplay: {
            'base::overlay': {
              ...(preset === undefined ? {} : { preset }),
              mappingRange: [20, 200],
              opacity: 0.4,
              transparentBackground: false,
            },
          },
        },
        manifest
      );
      await openVolViewPage(manifest);
      await openLayerDisplayControls();
      const select = $('[data-testid="layer-colormap"]');
      await expect(select).toHaveText(
        expect.stringContaining('DICOM Hot Iron')
      );
      await expect($('[data-testid="layer-range-min"] input')).toHaveValue(
        '20'
      );
      await expect($('[data-testid="layer-range-max"] input')).toHaveValue(
        '200'
      );
      await expect(
        $('[data-testid="layer-opacity-slider"] [role="slider"]')
      ).toHaveAttribute('aria-valuenow', '0.4');
      await expect(
        $('[data-testid="layer-transparent-background"] input')
      ).not.toBeChecked();
      await select.scrollIntoView({ block: 'center', behavior: 'instant' });
      await select.click();
      await expect($('[role="option"]*=DICOM Hot Iron')).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await browser.keys('Escape');
    });
  }

  it('applies palette, opacity and range edits in every view and preserves pixels for invalid drafts', async () => {
    await openDisplayFixture({
      preset: 'DICOM Hot Iron',
      mappingRange: [0, 255],
      opacity: 1,
      transparentBackground: true,
    });
    const transparent = $('[data-testid="layer-transparent-background"] input');
    await expect(transparent).toBeChecked();
    await browser.waitUntil(
      async () => (await $$('.Vue-Toastification__toast').length) === 0
    );
    await transparent.scrollIntoView({ block: 'center', behavior: 'instant' });
    await transparent.click();
    await expect(transparent).not.toBeChecked();
    const select = $('[data-testid="layer-colormap"]');
    await expect(select).toHaveText(expect.stringContaining('DICOM Hot Iron'));
    const rangeHandles = await $$(
      '[data-testid="layer-range-slider"] [role="slider"]'
    );
    expect(
      await rangeHandles.map((handle) => handle.getComputedLabel())
    ).toEqual(
      expect.arrayContaining([
        'Display range minimum',
        'Display range maximum',
        'Display range center',
      ])
    );
    expect(rangeHandles).toHaveLength(3);
    await expect(
      await $(
        '[data-testid="layer-opacity-slider"] [role="slider"]'
      ).getComputedLabel()
    ).toBe('Opacity');
    await browser.waitUntil(
      async () => (await $$('.Vue-Toastification__toast').length) === 0
    );
    await $('[data-testid="layer-range-min"] input').scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    await select.waitForClickable();
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>(
          '[data-testid="layer-opacity-slider"] [role="slider"]'
        )!
        .focus();
    });
    await browser.keys('Home');
    for (let step = 0; step < 5; step++) await browser.keys('PageUp');
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');

    const views = await volViewPage.getViews2D();
    expect(await views.length).toBe(3);
    const baseWindowing = await windowingLabels();
    expect(baseWindowing.every(Boolean)).toBe(true);
    await select.scrollIntoView({ block: 'center', behavior: 'instant' });
    await browser.waitUntil(
      async () => (await $$('.Vue-Toastification__toast').length) === 0
    );
    await select.click();
    await expect($('[role="option"]*=DICOM Hot Iron')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const coolToWarm = $('[role="option"]*=Cool to Warm');
    await coolToWarm.scrollIntoView({ block: 'center', behavior: 'instant' });
    await coolToWarm.waitForClickable();
    await coolToWarm
      .$('[data-testid="layer-palette-option-swatch"]')
      .waitForDisplayed();
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'overlay-palette-menu.png')
    );
    await coolToWarm.click();
    await expect(select).toHaveText(expect.stringContaining('Cool to Warm'));
    await browser.waitUntil(
      async () => {
        const pixels = await captureViewPixels();
        return pixels.length === 3 && pixels.every(({ blue }) => blue > 1000);
      },
      {
        timeoutMsg: 'Expected palette to change pixels in all three 2D views',
      }
    );

    const beforeRange = await captureViewPixels();
    await $('[data-testid="layer-range-min"] input').scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    await $('[data-testid="layer-range-min"] input').waitForClickable();
    await setValueVueInput($('[data-testid="layer-range-min"] input'), '-2.75');
    await setValueVueInput(
      $('[data-testid="layer-range-max"] input'),
      '100.25'
    );
    await expectAppliedRange('-2.75', '100.25', '100.3');
    await $('[data-testid="layer-range-max"] input').click();
    await expect($('[data-testid="layer-range-max"] input')).toHaveValue(
      '100.3'
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      '100.25'
    );
    await expectAppliedRange('-2.75', '100.25', '100.3');
    await browser.waitUntil(
      async () => {
        const after = await captureViewPixels();
        return (
          after.length === 3 &&
          after.every(
            ({ colored, blue, checksum }, index) =>
              colored > 1000 &&
              blue < beforeRange[index].blue &&
              checksum !== beforeRange[index].checksum
          )
        );
      },
      {
        timeoutMsg: 'Expected range to change pixels in all three 2D views',
      }
    );
    await expect($('[data-testid="layer-opacity-slider"] input')).toHaveValue(
      '0.5'
    );
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await expectAppliedRange('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await $('header').moveTo();
    const appliedPixels = await captureViewPixels();
    await setValueVueInput($('[data-testid="layer-range-max"] input'), '-3');
    await $('[data-testid="layer-range-max"] input').click();
    await browser.keys('Enter');
    await expect($('[data-testid="layer-range-status"]')).toHaveText(
      'Min must be less than Max.'
    );
    await expect($('[data-testid="layer-range-min"] input')).toHaveAttribute(
      'title',
      '-2.75'
    );
    await expect($('[data-testid="layer-range-max"] input')).toHaveAttribute(
      'title',
      '100.25'
    );
    expect(await captureViewPixels()).toEqual(appliedPixels);

    await setValueVueInput(
      $('[data-testid="layer-range-max"] input'),
      '100.25'
    );
    await setValueVueInput($('[data-testid="layer-range-min"] input'), '0');
    await setValueVueInput($('[data-testid="layer-range-max"] input'), '255');
    await $('header').moveTo();
    await expectAppliedRange('0', '255');
    await expect($('[data-testid="layer-colormap"]')).toHaveText(
      expect.stringContaining('Cool to Warm')
    );
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await browser.waitUntil(
      async () => {
        const fullRange = await captureViewPixels();
        return (
          fullRange.length === 3 &&
          fullRange.every(({ blue }, index) => blue === beforeRange[index].blue)
        );
      },
      {
        timeoutMsg:
          'Expected entering the full image range to restore the colors in all three views',
      }
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="layer-range-max-handle"]')!
        .focus();
    });
    for (let step = 0; step < 10; step++) await browser.keys('ArrowDown');
    await expect($('[data-testid="layer-range-min"] input')).toHaveValue('0');
    await expect($('[data-testid="layer-range-max"] input')).toHaveValue(
      '229.5'
    );
    expect(
      Number(
        await $('[data-testid="layer-range-max"] input').getAttribute('title')
      )
    ).toBeCloseTo(229.5, 8);
    await $('header').moveTo();
    await browser.waitUntil(
      async () => {
        const pixels = await captureViewPixels();
        return (
          pixels.length === 3 &&
          pixels.every(({ blue }, index) => blue < beforeRange[index].blue)
        );
      },
      {
        timeoutMsg:
          'Expected the range slider to update the overlay immediately in all three views',
      }
    );
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'overlay-display-controls.png')
    );
  });

  it('edits overlay opacity in 3D Only and applies it when returning to slices', async () => {
    const { baseWindowing, appliedPixels } = await openEditedDisplayFixture();
    await selectLayout('3D Only', 0, true);
    for (const name of [
      'colormap',
      'range-min',
      'range-max',
      'transparent-background',
      'opacity-slider',
    ]) {
      await expect($(`[data-testid="layer-${name}"]`)).toBeDisplayed();
      await expect($(`[data-testid="layer-${name}"] input`)).toBeEnabled();
    }
    for (const handle of await $$(
      '[data-testid="layer-range-slider"] [role="slider"]'
    ))
      await expect(handle).toHaveAttribute('tabindex', '0');
    const volumeSettings = await $$('.mapping-range-editor input').map(
      (input) => input.getValue()
    );
    expect(volumeSettings).toHaveLength(2);
    const opacity = $('[data-testid="layer-opacity-slider"] [role="slider"]');
    await opacity.execute((element) => element.focus());
    await browser.keys('Home');
    await expect(opacity).toHaveAttribute('aria-valuenow', '0');
    expect(
      await $$('.mapping-range-editor input').map((input) => input.getValue())
    ).toEqual(volumeSettings);

    await selectLayout('Axial Only', 1, false);
    await expectAppliedRange('-2.75', '100.25', '100.3');
    await expect(opacity).toHaveAttribute('aria-valuenow', '0');
    await $('header').moveTo();
    await browser.waitUntil(
      async () => {
        const pixels = await capture2DViewPixels(
          40,
          'base-without-overlay.png'
        );
        if (pixels.length !== 1) return false;
        let colored = 0;
        let brightGrayscale = 0;
        const { data } = pixels[0];
        for (let i = 0; i < data.length; i += 4) {
          const maximum = Math.max(data[i], data[i + 1], data[i + 2]);
          const minimum = Math.min(data[i], data[i + 1], data[i + 2]);
          if (maximum - minimum > 40) colored++;
          if (maximum - minimum < 5 && minimum > 32) brightGrayscale++;
        }
        return colored < 100 && brightGrayscale > 1000;
      },
      {
        timeoutMsg:
          'Expected the replacement axial view to show the base without colored overlay pixels',
      }
    );
    await selectLayout('3D Only', 0, true);
    await opacity.execute((element) => element.focus());
    await browser.keys(Array.from({ length: 5 }, () => 'PageUp'));
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(
      await $$('.mapping-range-editor input').map((input) => input.getValue())
    ).toEqual(volumeSettings);
    await selectLayout('Four Up', 3, true);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await expectRenderedPixels(appliedPixels);
  });

  it('restores global appearance after converting every 2D view', async () => {
    const { baseWindowing, appliedPixels } = await openEditedDisplayFixture();
    await convertSlicesToVolumes();
    await selectLayout('Four Up', 3, true);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await expectRenderedPixels(appliedPixels);
  });

  it('restores global appearance from a session saved after removing the last 2D view', async () => {
    const { baseWindowing, appliedPixels } =
      await openEditedDisplayFixture(true);
    await convertSlicesToVolumes();
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await openVolViewPage(saved);
    await volViewPage.waitForViewCounts(0, true);
    await openLayerDisplayControls();
    await expect($('[data-testid="layer-range-min"] input')).toBeEnabled();
    await selectLayout('Axial Only', 1, false);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await expectRenderedPixels(appliedPixels);
  });

  it('preserves transparent background and rendered colors when reopening a session', async () => {
    await openDisplayFixture({ mappingRange: [0, 229.5] });
    await expectDisplaySettings('0', '229.5');
    const beforeTransparent = await captureViewPixels();
    const restoredTransparent = $(
      '[data-testid="layer-transparent-background"] input'
    );
    await restoredTransparent.scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    await restoredTransparent.click();
    await expect(restoredTransparent).toBeChecked();
    const tooltipId =
      await restoredTransparent.getAttribute('aria-describedby');
    expect(tooltipId).toBeTruthy();
    await restoredTransparent.execute((input) => input.blur());
    await $('header').moveTo();
    await $(`[id="${tooltipId}"] .v-overlay__content`).waitForDisplayed({
      reverse: true,
      opacityProperty: false,
    });
    let transparentPixels = await captureViewPixels();
    await browser.waitUntil(
      async () => {
        transparentPixels = await captureViewPixels();
        return (
          transparentPixels.length === 3 &&
          transparentPixels.every(
            ({ checksum }, index) =>
              checksum !== beforeTransparent[index].checksum
          )
        );
      },
      {
        timeoutMsg:
          'Expected transparent background to update every view before saving',
      }
    );
    const transparentSession = await volViewPage.saveSession();
    await waitForDownload(
      path.join(TEMP_DIR, transparentSession),
      SESSION_SAVE_TIMEOUT
    );
    await openVolViewPage(transparentSession);
    await openLayerDisplayControls();
    await expect(
      $('[data-testid="layer-transparent-background"] input')
    ).toBeChecked();
    await expectRenderedPixels(transparentPixels);

    const select = $('[data-testid="layer-colormap"]');
    await select.scrollIntoView({ block: 'center', behavior: 'instant' });
    await select.click();
    await expect($('[role="option"]*=Cool to Warm')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await browser.keys('Escape');
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'overlay-transparent-restored.png')
    );
  });

  it('offers the curated palette inventory and renders Spring and Winter in every view', async () => {
    await openDisplayFixture({
      mappingRange: [0, 229.5],
      transparentBackground: true,
    });
    const select = $('[data-testid="layer-colormap"]');
    await select.scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    await select.click();
    await expectPaletteOptions();
    await expect($('[role="option"]*=Cool to Warm')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    for (const title of ['DICOM Spring', 'DICOM Winter']) {
      await browser.keys('Escape');
      await $('header').moveTo();
      const beforePalette = await captureViewPixels();
      await select.click();
      const option = $(`[role="option"]*=${title}`);
      await option.scrollIntoView({ block: 'center', behavior: 'instant' });
      await option.waitForClickable();
      await expect(
        option.$('[data-testid="layer-palette-option-swatch"]')
      ).toBeDisplayed();
      await option.click();
      await expect(select).toHaveText(expect.stringContaining(title));
      await $('header').moveTo();
      await browser.waitUntil(
        async () => {
          const pixels = await captureViewPixels();
          return (
            pixels.length === 3 &&
            pixels.every(
              ({ checksum }, index) =>
                checksum !== beforePalette[index].checksum
            )
          );
        },
        {
          timeoutMsg: `Expected ${title} to change colors in all three 2D views`,
        }
      );
      await select.click();
      await expect($(`[role="option"]*=${title}`)).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'overlay-short-palette-menu.png')
    );
    await browser.keys('Escape');
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
