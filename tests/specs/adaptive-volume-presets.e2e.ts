import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  appearance,
  colorShift,
  createVolumeScalars,
  openVolumeRenderingControls,
  pixelDifference,
  visibleAppearance,
  type Appearance,
} from './volumeRenderingTestUtils';
import {
  openVolViewPage,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';
import {
  captureOpacityEditor,
  hasHistogramRequest,
  holdVolumeHistograms,
  releaseHistogram,
  restoreHistogramWorkers,
  selectAdaptiveHistogramPhase,
  waitForHistogram,
} from './volumeHistogramTestUtils';

const resetSelector = '[data-testid="volume-reset-color-opacity"]';
let fixtureIndex = 0;
const encodings = {
  uint8: { elementType: 'MET_UCHAR', scale: 1 },
  uint16: { elementType: 'MET_USHORT', scale: 200 },
  float: { elementType: 'MET_FLOAT', scale: 1 / 255 },
} as const;

type Encoding = keyof typeof encodings;

// Curved bright layers surrounded by empty voxels, with identical geometry and
// scalar ratios in all three encodings.
function writeVolume(
  encoding: Encoding,
  variant:
    | 'layers'
    | 'outlier'
    | 'empty'
    | 'constant'
    | 'binary'
    | 'ct' = 'layers',
  scalarScale = 1
) {
  const { elementType, scale } = encodings[encoding];
  // A power-of-two binary fixture puts signal only on even columns. A fixed
  // two-voxel midpoint sampler would miss every foreground voxel.
  const size = variant === 'binary' ? 64 : 48;
  const voxels = createVolumeScalars(size, encoding, (x, y, z) => {
    const u = (x - (size - 1) / 2) / (size * 0.35);
    const v = (y - (size - 1) / 2) / (size * 0.35);
    const radius = u * u + v * v;
    const depth = z - size * 0.4 - 3 * radius;
    const layeredValue =
      radius < 1 && depth >= 0 && depth < 12
        ? Math.round(30 + 170 * Math.sin((depth / 12) * Math.PI) ** 2)
        : 0;
    const value =
      variant === 'empty'
        ? 0
        : variant === 'constant'
          ? 100
          : variant === 'binary'
            ? layeredValue > 0 && x % 2 === 0
              ? 100
              : 0
            : layeredValue;
    return (
      value *
      (encoding === 'uint16' && variant === 'ct' ? 10 : scale) *
      scalarScale
    );
  });
  if (variant === 'outlier') voxels.writeFloatLE(1e6, 0);
  const header = [
    'ObjectType = Image',
    'NDims = 3',
    `DimSize = ${size} ${size} ${size}`,
    'ElementSpacing = 1 1 1',
    'BinaryDataByteOrderMSB = False',
    `ElementType = ${elementType}`,
    'ElementDataFile = LOCAL',
    '',
  ].join('\n');
  const name = `adaptive-volume-${encoding}-${variant}${scalarScale === 1 ? '' : `-${scalarScale}`}.mha`;
  fs.writeFileSync(
    path.join(TEMP_DIR, name),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return name;
}

async function selectPreset(name: string) {
  const card = $(`[data-testid="volume-preset-${name}"]`);
  await card.scrollIntoView({ block: 'center', behavior: 'instant' });
  await card.waitForClickable();
  await card.click();
  await expect(card).toHaveElementClass('bg-blue');
  await expect($(resetSelector)).toBeDisabled();
  await $('header').moveTo();
}

async function renderedProfile(name: string) {
  const card = $(`[data-testid="volume-preset-${name}"]`);
  const selected = (await card.getAttribute('class'))?.includes('bg-blue');
  const previous = await visibleAppearance();
  await selectPreset(name);
  if (!selected) {
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), previous, 4) > 2,
      { timeoutMsg: `Expected ${name} to change the visible volume opacity` }
    );
  }
  return visibleAppearance();
}

async function openVolume(
  encoding: Encoding,
  variant:
    | 'layers'
    | 'outlier'
    | 'empty'
    | 'constant'
    | 'binary'
    | 'ct' = 'layers',
  scalarScale = 1
) {
  const name = writeVolume(encoding, variant, scalarScale);
  const configName = `adaptive-volume-layout-${encoding}-${variant}-${fixtureIndex++}.json`;
  await writeManifestToFile(
    {
      layouts: {
        default: {
          direction: 'row',
          items: [
            { type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' },
          ],
        },
      },
    },
    configName
  );
  await volViewPage.open(`?urls=[tmp/${configName},tmp/${name}]`);
  await volViewPage.waitForViewCounts(0, true);
  await openVolumeRenderingControls();
  await selectPreset('Adaptive-Balanced');
}

describe('adaptive volume presets', () => {
  it('keeps the fitted histogram when an older ordinary histogram finishes late', async () => {
    await openVolume('uint16');
    await holdVolumeHistograms();
    try {
      await selectPreset('CT-AAA');
      await waitForHistogram('ordinary');
      await selectAdaptiveHistogramPhase();
      await selectPreset('Adaptive-Balanced');
      if (await hasHistogramRequest('adaptive'))
        await waitForHistogram('adaptive');
      await releaseHistogram('adaptive');
      const fitted = await captureOpacityEditor();
      await releaseHistogram('ordinary');
      expect((await captureOpacityEditor()) === fitted).toBe(true);
      await expect(
        $('[data-testid="volume-preset-Adaptive-Balanced"]')
      ).toHaveElementClass('bg-blue');
    } finally {
      await restoreHistogramWorkers();
    }
  });

  describe('intensity scaling', () => {
    const names = ['Transparent', 'Balanced', 'Surface'];
    const reference: Record<string, Appearance> = {};
    before(async () => {
      await openVolume('uint8');
      const cards = $$('[data-testid^="volume-preset-Adaptive-"]');
      await expect(cards).toBeElementsArrayOfSize(3);
      const rows = (await cards.map((card) =>
        card.execute((element) => element.getBoundingClientRect().top)
      )) as number[];
      expect(new Set(rows).size).toBe(1);
      for (const name of names) {
        reference[name] = await renderedProfile(`Adaptive-${name}`);
      }
    });

    for (const encoding of Object.keys(encodings) as Encoding[]) {
      it(`renders ${encoding} layers with three distinct grayscale opacity choices`, async () => {
        await openVolume(encoding);
        const results: Appearance[] = [];
        for (const name of names) {
          const rendered = await renderedProfile(`Adaptive-${name}`);
          // Block means compare structure and brightness despite ray jitter.
          expect(pixelDifference(rendered, reference[name], 4)).toBeLessThan(3);
          expect(
            Math.abs(rendered.visible - reference[name].visible)
          ).toBeLessThan(reference[name].visible * 0.02);
          for (const prior of results)
            expect(pixelDifference(rendered, prior, 4)).toBeGreaterThan(2);
          results.push(rendered);
        }
      });
    }
  });

  it('preserves manual appearance in a saved session and resets the selected preset on request', async () => {
    await openVolume('uint16');
    const fitted = await renderedProfile('Adaptive-Transparent');
    const shift = await colorShift();
    const fittedShift = (await shift.getAttribute('aria-valuenow'))!;
    await shift.execute((element) => element.focus());
    await browser.keys('End');
    const editedShift = (await shift.getAttribute('aria-valuenow'))!;
    expect(editedShift).not.toBe(fittedShift);
    await expect($(resetSelector)).toBeEnabled();
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), fitted) > 2,
      {
        timeoutMsg:
          'Expected a manual color shift to change the rendered volume',
      }
    );
    const colorEdited = await appearance();
    const opacity = $('[data-testid="volume-opacity-editor"] canvas');
    await opacity.scrollIntoView({ block: 'center', behavior: 'instant' });
    await opacity.waitForStable();
    const location = await opacity.getLocation();
    const dimensions = await opacity.getSize();
    await browser
      .action('pointer')
      .move({
        x: Math.round(location.x + dimensions.width * 0.94),
        y: Math.round(location.y + dimensions.height * 0.7),
      })
      .perform();
    // Use the rendered green peak handle to adjust opacity height, keeping the
    // low endpoint at zero so the padded voxels remain transparent.
    let handle: { x: number; y: number } | null = null;
    await browser.waitUntil(
      async () => {
        handle = (await opacity.execute((element) => {
          const canvas = element as HTMLCanvasElement;
          const data = canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          for (let y = 0; y < canvas.height; y++) {
            for (
              let x = Math.floor(canvas.width * 0.7);
              x < canvas.width;
              x++
            ) {
              const i = (y * canvas.width + x) * 4;
              if (data[i] === 50 && data[i + 1] === 150 && data[i + 2] === 50)
                return { x: x / canvas.width, y: y / canvas.height };
            }
          }
          return null;
        })) as { x: number; y: number } | null;
        return handle !== null;
      },
      { timeoutMsg: 'Expected the visible opacity peak handle' }
    );
    const x = Math.round(location.x + dimensions.width * handle!.x);
    const y = Math.round(location.y + dimensions.height * handle!.y);
    await browser
      .action('pointer')
      .move({ x, y })
      .down()
      .move({ x, y: y - 25, duration: 100 })
      .up()
      .perform();
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), colorEdited) > 2,
      {
        timeoutMsg: 'Expected dragging the opacity height to change the volume',
      }
    );
    const edited = await appearance();
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await openVolViewPage(saved);
    await volViewPage.waitForViewCounts(0, true);
    await openVolumeRenderingControls();
    await expect(
      $('[data-testid="volume-preset-Adaptive-Transparent"]')
    ).toHaveElementClass('bg-blue');
    await expect(await colorShift()).toHaveAttribute(
      'aria-valuenow',
      editedShift
    );
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), edited, 4) < 3,
      {
        timeoutMsg:
          'Expected the saved manual appearance to survive restoration',
      }
    );
    const refit = $(resetSelector);
    await refit.scrollIntoView({ block: 'center', behavior: 'instant' });
    await refit.click();
    await expect(refit).toBeDisabled();
    await expect(await colorShift()).toHaveAttribute(
      'aria-valuenow',
      fittedShift
    );
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), fitted, 4) < 3,
      {
        timeoutMsg:
          'Expected resetting to restore the original adaptive appearance',
      }
    );
  });

  it('preserves CT edits across tabs and resets color and opacity without changing its palette or lighting', async () => {
    await openVolume('uint16', 'ct');
    await selectPreset('CT-AAA');
    const cinematic = $('.v-expansion-panel-title*=Cinematic Rendering');
    await cinematic.scrollIntoView({ block: 'center', behavior: 'instant' });
    if ((await cinematic.getAttribute('aria-expanded')) !== 'true')
      await cinematic.click();
    await waitForModuleTransitions();
    const ambient = $(
      "//label[normalize-space(.)='Ambient']/ancestor::div[contains(@class, 'v-slider')][1]//*[@role='slider']"
    );
    await ambient.scrollIntoView({ block: 'center', behavior: 'instant' });
    await ambient.execute((element) => element.focus());
    await browser.keys('End');
    await expect(ambient).toHaveAttribute('aria-valuenow', '1');
    await expect($(resetSelector)).toBeDisabled();
    await selectPreset('Adaptive-Balanced');
    await expect(ambient).toHaveAttribute('aria-valuenow', '1');
    await selectPreset('CT-AAA');
    await expect(ambient).toHaveAttribute('aria-valuenow', '1');
    await ambient.execute((element) => element.blur());
    await $('header').moveTo();
    await browser.waitUntil(async () => (await appearance()).visible > 250);
    const original = await appearance();
    const shift = await colorShift();
    const initialShift = (await shift.getAttribute('aria-valuenow'))!;
    expect(initialShift).toBe('0');
    await shift.execute((element) => element.focus());
    await browser.keys('ArrowRight');
    await expect($(resetSelector)).toBeEnabled();
    await browser.keys('ArrowLeft');
    await expect(shift).toHaveAttribute('aria-valuenow', initialShift);
    await expect($(resetSelector)).toBeDisabled();
    await shift.execute((element) => element.blur());
    const opacity = $('[data-testid="volume-opacity-editor"] canvas');
    await opacity.scrollIntoView({ block: 'center', behavior: 'instant' });
    await opacity.waitForStable();
    const bounds = (await opacity.execute((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    })) as Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
    const x = Math.round(bounds.x + bounds.width * 0.5);
    const y = Math.round(bounds.y + bounds.height * 0.5);
    await browser
      .action('pointer')
      .move({ x, y })
      .down()
      .move({ x: x + Math.round(bounds.width * 0.2), y, duration: 100 })
      .up()
      .perform();
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), original) > 2,
      {
        timeoutMsg: 'Expected a CT opacity shift to change the rendered volume',
      }
    );
    await expect($(resetSelector)).toBeEnabled();
    const opacityEdited = await appearance();
    await shift.scrollIntoView({ block: 'center', behavior: 'instant' });
    await shift.execute((element) => element.focus());
    await browser.keys('End');
    const changedShift = (await shift.getAttribute('aria-valuenow'))!;
    expect(changedShift).not.toBe(initialShift);
    await expect($(resetSelector)).toBeEnabled();
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), opacityEdited) > 2
    );
    const edited = await appearance();
    await $('[data-testid="module-tab-Data"]').click();
    await waitForModuleTransitions();
    await openVolumeRenderingControls();
    await expect(await colorShift()).toHaveAttribute(
      'aria-valuenow',
      changedShift
    );
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), edited, 4) < 3,
      {
        timeoutMsg:
          'Expected both manual CT edits to survive reopening Rendering',
      }
    );
    const presets = $('.v-expansion-panel-title*=Color Presets');
    await presets.scrollIntoView({ block: 'center', behavior: 'instant' });
    await presets.click();
    await expect(presets).toHaveAttribute('aria-expanded', 'false');
    await waitForModuleTransitions();
    const reset = $(resetSelector);
    await reset.scrollIntoView({ block: 'center', behavior: 'instant' });
    await expect(reset).toBeDisplayed();
    await expect(reset).toHaveAttribute(
      'aria-label',
      'Reset color and opacity'
    );
    await expect($('.mapping-range-editor').$(resetSelector)).toBeDisplayed();
    await expect(reset).toBeEnabled();
    await browser.saveScreenshot(
      path.join(TEMP_DIR, 'volume-reset-placement.png')
    );
    await reset.click();
    await expect(reset).toBeDisabled();
    await expect(await colorShift()).toHaveAttribute(
      'aria-valuenow',
      initialShift
    );
    await cinematic.scrollIntoView({ block: 'center', behavior: 'instant' });
    if ((await cinematic.getAttribute('aria-expanded')) !== 'true')
      await cinematic.click();
    await waitForModuleTransitions();
    await expect(
      $(
        "//label[normalize-space(.)='Ambient']/ancestor::div[contains(@class, 'v-slider')][1]//*[@role='slider']"
      )
    ).toHaveAttribute('aria-valuenow', '1');
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), original, 4) < 3,
      {
        timeoutMsg:
          'Expected reset to restore CT color and opacity with the edited lighting',
      }
    );
    await presets.scrollIntoView({ block: 'center', behavior: 'instant' });
    await presets.click();
    await expect($('[data-testid="volume-preset-CT-AAA"]')).toHaveElementClass(
      'bg-blue'
    );
  });

  it('enables Reset for visible contrast edits on tiny floating-point intensities', async () => {
    await openVolume('float', 'layers', 1e-12);
    const original = await visibleAppearance();
    const shift = await colorShift();
    const initialShift = (await shift.getAttribute('aria-valuenow'))!;
    await shift.execute((element) => element.focus());
    await browser.keys('End');
    expect(await shift.getAttribute('aria-valuenow')).not.toBe(initialShift);
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), original) > 2,
      {
        timeoutMsg:
          'Expected the tiny-float color shift to visibly change the volume',
      }
    );
    const reset = $(resetSelector);
    await expect(reset).toBeEnabled();
    await reset.scrollIntoView({ block: 'center', behavior: 'instant' });
    await reset.click();
    await expect(reset).toBeDisabled();
    await expect(await colorShift()).toHaveAttribute(
      'aria-valuenow',
      initialShift
    );
    await browser.waitUntil(
      async () => pixelDifference(await appearance(), original, 4) < 3,
      {
        timeoutMsg:
          'Expected Reset to restore the tiny-float volume appearance',
      }
    );
  });

  it('keeps an all-zero volume transparent', async () => {
    await openVolume('uint8', 'empty');
    await browser.waitUntil(async () => (await appearance()).visible === 0, {
      timeoutMsg: 'Expected an all-zero volume to remain transparent',
    });
  });

  it('keeps nonzero constant voxels visible', async () => {
    await openVolume('uint8', 'constant');
    await browser.waitUntil(async () => (await appearance()).visible > 500, {
      timeoutMsg: 'Expected nonzero constant voxels to remain visible',
    });
  });

  it('shows sparse binary foreground and still offers ordinary CT presets', async () => {
    await openVolume('uint8', 'binary');
    await visibleAppearance();
    const ordinary = $('[data-testid="volume-preset-CT-Bone"]');
    await ordinary.scrollIntoView({ block: 'center', behavior: 'instant' });
    await ordinary.click();
    await expect(ordinary).toHaveElementClass('bg-blue');
    await expect($(resetSelector)).toBeDisabled();

    await selectPreset('US-Fetal');
    await expect(await colorShift()).toHaveAttribute('aria-valuenow', '0');
    const width = $('[data-testid="volume-color-width"] [role="slider"]');
    await width.scrollIntoView({ block: 'center', behavior: 'instant' });
    await expect(width).toHaveAttribute('aria-valuenow', '280');
    await width.execute((element) => element.focus());
    await browser.keys('ArrowRight');
    await expect($(resetSelector)).toBeEnabled();
    await browser.keys('ArrowLeft');
    await expect(width).toHaveAttribute('aria-valuenow', '280');
    await expect($(resetSelector)).toBeDisabled();
  });

  it('keeps the layers visible when one padded voxel is an extreme outlier', async () => {
    await openVolume('float', 'outlier');
    await visibleAppearance();
    for (const preset of ['Adaptive-Transparent', 'Adaptive-Surface']) {
      await renderedProfile(preset);
    }
  });
});
