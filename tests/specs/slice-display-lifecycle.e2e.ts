import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  openLayerDisplayControls,
} from './layerDisplayTestUtils';
import {
  capture2DViewScreenshotMetrics,
  captureViewPixels,
  openVolViewPage,
  selectLayout,
  waitForModuleTransitions,
  writeManifestToFile,
  writeMetaImage,
} from './utils';

const baseName = 'slice-lifecycle-base.mha';
const baseRange = (endpoint: 'min' | 'max') =>
  $(`[data-testid="base-image-range-${endpoint}"] input`);
const visibility = (image: 'base-image' | 'layer') =>
  $(`[data-testid="${image}-visibility"]`);
const captureSlices = () =>
  capture2DViewScreenshotMetrics('slice-lifecycle.png');
const captureSlicePixels = () =>
  captureViewPixels('[data-testid~="vtk-two-view"]', 40, 'slice-lifecycle.png');
const obliqueSlices =
  '.oblique-grid > .d-flex:not(:nth-child(2)) [data-testid="vtk-view"]';
const captureOblique = () =>
  captureViewPixels(obliqueSlices, 40, 'slice-lifecycle-oblique.png');

const coloredPixelCount = (data: Buffer) =>
  data.filter(
    (red, i) =>
      i % 4 === 0 &&
      Math.max(red, data[i + 1], data[i + 2]) -
        Math.min(red, data[i + 1], data[i + 2]) >
        40
  ).length;

async function selectGrid(index: number, count: number) {
  await volViewPage.layoutButton.click();
  await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
  const cell = $$('.v-menu.v-overlay--active .grid-cell')[index].$(
    '.grid-cell-box'
  );
  await cell.moveTo();
  await cell.waitForClickable();
  await cell.click();
  await expect($$('.grid-item')).toBeElementsArrayOfSize(count);
}

async function showBaseInAllViews() {
  await $('[data-testid="module-tab-Data"]').click();
  await waitForModuleTransitions();
  const card = $(`.image-list-card*=${baseName}`);
  await card.$('[data-testid="dataset-menu-button"]').click();
  await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
  await $('.v-list-item*=Show in all views').click();
  await browser.keys('Escape');
}

async function setBaseRange(minimum: number, maximum: number) {
  await baseRange('min').scrollIntoView({
    block: 'center',
    behavior: 'instant',
  });
  await setValueVueInput(baseRange('min'), String(minimum));
  await setValueVueInput(baseRange('max'), String(maximum));
  await browser.keys('Enter');
}

async function expectBaseSettings() {
  await expect(baseRange('min')).toHaveAttribute('title', '20');
  await expect(baseRange('max')).toHaveAttribute('title', '200');
  await expect($('[data-testid="base-image-colormap"]')).toHaveText(
    expect.stringContaining('DICOM Hot Iron')
  );
  for (const view of await $$(
    `[data-testid~="vtk-two-view"], ${obliqueSlices}`
  ))
    await expect(view).toHaveText(
      expect.stringContaining('W/L: 180.00 / 110.00')
    );
}

async function expectColoredSlices(count: number) {
  await $('header').moveTo();
  await browser.waitUntil(async () => {
    const pixels = await captureSlices();
    return (
      pixels.length === count && pixels.every(({ colored }) => colored > 1000)
    );
  });
}

async function expectSlicesMatch(
  expected: Awaited<ReturnType<typeof captureSlicePixels>>
) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const pixels = await captureSlicePixels();
      return (
        pixels.length === expected.length &&
        pixels.every(
          ({ width, data }, index) =>
            width === expected[index].width && data.equals(expected[index].data)
        )
      );
    },
    { timeoutMsg: 'Expected restored slice colors and zoom to match' }
  );
}

async function openDisplay(layout: 'Four Up' | 'flat' | 'grid' = 'Four Up') {
  const base = writeMetaImage(baseName);
  const overlay = writeMetaImage('slice-lifecycle-overlay.mha', { step: 29 });
  await writeManifestToFile(
    {
      ...layeredImageManifest(base, overlay),
      ...(layout === 'flat'
        ? {
            layout: {
              direction: 'row',
              items: [0, 1].map((slotIndex) => ({ type: 'slot', slotIndex })),
            },
            layoutSlots: ['left', 'right'],
            activeView: 'left',
            viewByID: Object.fromEntries(
              ['left', 'right'].map((id) => [
                id,
                {
                  id,
                  type: '2D',
                  name: 'Axial',
                  dataID: 'base',
                  options: { orientation: 'Axial' },
                },
              ])
            ),
          }
        : {}),
      layerDisplay: {
        'base::overlay': {
          preset: 'Cool to Warm',
          mappingRange: [0, 255],
          opacity: 0.35,
          transparentBackground: false,
        },
      },
    },
    'slice-lifecycle.json'
  );
  await openVolViewPage('slice-lifecycle.json');
  if (layout === 'flat') await volViewPage.waitForViewCounts(2, false);
  else await selectLayout('Four Up', 3, true);
  if (layout === 'grid') await selectGrid(4, 4);
  await showBaseInAllViews();
  await openLayerDisplayControls();
  const palette = $('[data-testid="base-image-colormap"]');
  await palette.scrollIntoView({ block: 'center', behavior: 'instant' });
  await palette.click();
  const option = $('[role="option"]*=DICOM Hot Iron');
  await option.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  await option.waitForClickable();
  await option.click();
  await setBaseRange(20, 200);
  await expectBaseSettings();
  await expectColoredSlices(layout === 'flat' ? 2 : 3);
}

async function toggleVisibility(image: 'base-image' | 'layer') {
  await visibility(image).scrollIntoView({
    block: 'center',
    behavior: 'instant',
  });
  await visibility(image).click();
  await $('header').moveTo();
}

describe('Slice display lifecycle', () => {
  it('preserves distinct zoom and appearance when maximizing either slice in a flat layout', async () => {
    await openDisplay('flat');
    const fittedPixels = await captureSlicePixels();
    for (const index of [0, 1]) {
      const unzoomed = await captureSlices();
      const canvas = (await volViewPage.getViews2D())[index].$('canvas');
      await browser
        .action('pointer')
        .move({ origin: canvas })
        .down({ button: 2 })
        .move({ origin: canvas, y: 40 + index * 25 })
        .up({ button: 2 })
        .perform();
      await $('header').moveTo();
      await browser.waitUntil(
        async () =>
          Math.abs(
            (await captureSlices())[index].colored - unzoomed[index].colored
          ) > 1000,
        { timeoutMsg: 'Expected the zoom gesture to change the image area' }
      );
    }
    const zoomed = await captureSlices();
    expect(zoomed[0].colored).not.toBe(zoomed[1].colored);
    const zoomedPixels = await captureSlicePixels();
    for (const index of [0, 1]) {
      await (await volViewPage.getViews2D())[index].doubleClick();
      await volViewPage.waitForViewCounts(1, false);
      await expectColoredSlices(1);
      await (await volViewPage.getViews2D())[0].doubleClick();
      await volViewPage.waitForViewCounts(2, false);
      await expectSlicesMatch(zoomedPixels);
      await expectBaseSettings();
    }

    const resetButtons = $$('.vtk-gutter button');
    await expect(resetButtons).toBeElementsArrayOfSize(2);
    for (const button of await resetButtons) await button.click();
    await expectSlicesMatch(fittedPixels);

    const beforeRange = await captureSlices();
    await setBaseRange(60, 180);
    await $('header').moveTo();
    await browser.waitUntil(async () =>
      (await captureSlices()).every(
        ({ checksum }, index) => checksum !== beforeRange[index].checksum
      )
    );
    const withOverlay = await captureSlices();
    const withOverlayPixels = await captureSlicePixels();
    await toggleVisibility('layer');
    await browser.waitUntil(async () =>
      (await captureSlices()).every(
        ({ checksum }, index) => checksum !== withOverlay[index].checksum
      )
    );
    await toggleVisibility('layer');
    await expectSlicesMatch(withOverlayPixels);
  });

  it('inherits base palette, window and visibility in newly created grid slots', async () => {
    await openDisplay('grid');
    await toggleVisibility('layer');
    await expectColoredSlices(3);
    await toggleVisibility('base-image');
    await expect(visibility('base-image')).toHaveText(
      expect.stringContaining('SHOW')
    );
    await selectGrid(7, 6);
    await showBaseInAllViews();
    await volViewPage.waitForViewCounts(5, true);
    await openLayerDisplayControls();
    await expectBaseSettings();
    await expect(visibility('base-image')).toHaveText(
      expect.stringContaining('SHOW')
    );
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const pixels = await captureSlices();
      return (
        pixels.length === 5 && pixels.every(({ colored }) => colored < 100)
      );
    });
    await toggleVisibility('base-image');
    await expectColoredSlices(5);
    await expectBaseSettings();
  });

  it('keeps base and overlay rendering live through repeated layout replacement', async () => {
    await openDisplay();
    const fourUp = await captureSlicePixels();
    const errors: string[] = [];

    const onLog = ({ text }: { text: string | null }) => {
      if (
        text &&
        /instance deleted - cannot call any method|(?:deleted|disposed).*(?:VTK|renderer|mapper|actor)|WebGL.*(?:INVALID_|CONTEXT_LOST|error)|(?:shader|program).*(?:error|failed)|(?:error|failed|could not).*(?:shader|WebGL)/i.test(
          text
        )
      )
        errors.push(text);
    };

    browser.on('log.entryAdded', onLog);
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        await (await volViewPage.getViews2D())[cycle].doubleClick();
        await volViewPage.waitForViewCounts(1, false);
        await expectColoredSlices(1);
        await (await volViewPage.getViews2D())[0].doubleClick();
        await volViewPage.waitForViewCounts(3, true);
        await expectSlicesMatch(fourUp);
        await selectLayout('3D Only', 0, true);
        await volViewPage.layoutButton.click();
        await $('.v-list-item-title=Oblique').waitForClickable();
        await $('.v-list-item-title=Oblique').click();
        await $('.oblique-grid').waitForDisplayed();
        await $('.oblique-grid').waitForStable();
        await expectBaseSettings();
        await $('header').moveTo();
        await browser.waitUntil(async () => {
          const pixels = await captureOblique();
          return (
            pixels.length === 3 &&
            pixels.every(({ data }) => coloredPixelCount(data) > 1000)
          );
        });
        const baseImages = await captureOblique();
        await toggleVisibility('base-image');
        await browser.waitUntil(async () => {
          const pixels = await captureOblique();
          return (
            pixels.length === 3 &&
            pixels.every(
              ({ data }, index) =>
                coloredPixelCount(data) <
                coloredPixelCount(baseImages[index].data) / 3
            )
          );
        });
        await toggleVisibility('base-image');
        await browser.waitUntil(async () => {
          const pixels = await captureOblique();
          return (
            pixels.length === 3 &&
            pixels.every(({ data }, index) =>
              data.equals(baseImages[index].data)
            )
          );
        });
        await selectLayout('Four Up', 3, true);
        await expectSlicesMatch(fourUp);
      }
      expect(errors).toEqual([]);
    } finally {
      browser.off('log.entryAdded', onLog);
    }
  });
});
