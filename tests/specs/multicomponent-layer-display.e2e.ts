import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  layeredImageManifest,
  openLayerDisplayControls,
} from './layerDisplayTestUtils';
import { TEMP_DIR } from '@/wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  captureViewPixels,
  makeTempDir,
  openVolViewPage,
  selectLayout,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

function writeColorImage(
  name: string,
  channels: number[],
  type = 'unsigned char',
  alphaBands = false
) {
  const directory = makeTempDir(name);
  const header = [
    'NRRD0005',
    `type: ${type}`,
    'dimension: 4',
    `sizes: ${channels.length} 16 16 16`,
    'kinds: vector domain domain domain',
    'space: left-posterior-superior',
    'space directions: none (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ].join('\n');
  const maximum =
    type === 'float' ? 1 : type === 'unsigned short' ? 65535 : 255;
  const values = Array.from({ length: 4096 }, (_, index) => {
    if (channels.length <= 2 && (index === 0 || index === 4095))
      return [index === 0 ? 0 : 255, ...channels.slice(1).map(() => 0)].join(
        ' '
      );
    if (alphaBands) {
      const x = index % 16;
      const y = Math.floor(index / 16) % 16;
      const z = Math.floor(index / 256);
      const band = (Number(x >= 10) + Number(y >= 10) + Number(z >= 10)) % 3;
      return [...channels.slice(0, 3), [0, channels[3], maximum][band]].join(
        ' '
      );
    }
    return channels.join(' ');
  }).join(' ');
  writeFileSync(join(directory, `${name}.nrrd`), `${header}\n\n${values}`);
  return `${name}/${name}.nrrd`;
}

async function openOverlayControls(
  name: string,
  channels: number[],
  { savedDisplay = true, type = 'unsigned char', alphaBands = false } = {}
) {
  const base = writeColorImage('multicomponent-base', [128]);
  const overlay = writeColorImage(name, channels, type, alphaBands);
  await writeManifestToFile(
    {
      ...layeredImageManifest(base, overlay),
      ...(savedDisplay
        ? {
            layerDisplay: {
              'base::overlay': {
                preset: 'Grayscale',
                mappingRange: [0, 255],
                opacity: 1,
                transparentBackground: false,
              },
            },
          }
        : {}),
    },
    'multicomponent-overlay.json'
  );
  await openVolViewPage('multicomponent-overlay.json');
  await $(`.image-list-card*=${base.split('/').at(-1)}`)
    .$('[data-testid="dataset-menu-button"]')
    .click();
  await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
  await $('.v-list-item*=Show in all views').click();
  await browser.keys('Escape');
  await openLayerDisplayControls();
  await setValueVueInput($('[data-testid="base-image-range-min"] input'), '0');
  await setValueVueInput(
    $('[data-testid="base-image-range-max"] input'),
    '255'
  );
}

async function expectImagePixels(
  expectedColors: number[][],
  viewCount = 3,
  selector = '[data-testid~="vtk-two-view"]',
  absentColors: number[][] = []
) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const views = await captureViewPixels(
        selector,
        40,
        'multicomponent-layer-display.png'
      );
      return (
        views.length === viewCount &&
        views.every(({ data }) => {
          const matchingPixels = (expected: number[]) => {
            let matching = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (
                expected.every(
                  (value, channel) => Math.abs(data[i + channel] - value) <= 2
                )
              )
                matching++;
            }
            return matching;
          };
          return (
            expectedColors.every(
              (expected) => matchingPixels(expected) > 1000
            ) &&
            absentColors.every((expected) => matchingPixels(expected) === 0)
          );
        })
      );
    },
    {
      timeoutMsg: `Expected substantial image pixels with RGB ${JSON.stringify(expectedColors)} in ${viewCount} slice views`,
    }
  );
}

const nativeTypes = [
  { type: 'unsigned char', scale: 1 },
  { type: 'unsigned short', scale: 257 },
  { type: 'float', scale: 1 / 255 },
];

const nativeColor = [180, 30, 60];
const obliqueSlices =
  '.oblique-grid > .d-flex:not(:nth-child(2)) [data-testid="vtk-view"]';

const blendedColor = (alpha: number, background = 128) =>
  nativeColor.map((channel) =>
    Math.round(channel * alpha + background * (1 - alpha))
  );

async function showOblique() {
  await volViewPage.layoutButton.click();
  await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
  await $('.v-list-item-title=Oblique').click();
  await $('.oblique-grid').waitForDisplayed();
}

async function openBaseControls() {
  await volViewPage.renderingModuleTab.click();
  const volume = $('[data-testid="volume-rendering-toggle"]');
  if (
    (await volume.isExisting()) &&
    (await volume.getAttribute('aria-expanded')) === 'true'
  )
    await volume.click();
  await waitForModuleTransitions();
}

describe('Multicomponent image display controls', () => {
  for (const { type, scale } of nativeTypes) {
    for (const components of [3, 4]) {
      it(`renders native ${type} ${components}-component overlays with independent layer opacity`, async () => {
        const rgba = components === 4;
        const channels = [...nativeColor, ...(rgba ? [128] : [])].map(
          (channel) => channel * scale
        );
        await openOverlayControls(
          `overlay-${type.replace(' ', '-')}-${components}-component`,
          channels,
          { type, alphaBands: rgba }
        );
        for (const name of [
          'colormap',
          'range-min',
          'range-max',
          'transparent-background',
        ]) {
          await expect($(`[data-testid="layer-${name}"]`)).toBeDisplayed();
          await expect($(`[data-testid="layer-${name}"] input`)).toBeDisabled();
        }
        await expect($('[data-testid="layer-contrast"]')).toBeDisabled();
        await expect(
          $('[data-testid="layer-opacity-slider"] input')
        ).toBeEnabled();
        const visibility = $('[data-testid="layer-visibility"]');
        await expect(visibility).toBeEnabled();

        const colors = (opacity: number) =>
          (rgba ? [0, 128 / 255, 1] : [1]).map((alpha) =>
            blendedColor(alpha * opacity)
          );

        const foregroundColors = colors(0.5).filter((color) =>
          color.some((channel) => channel !== 128)
        );
        await expectImagePixels(colors(1));
        if (!rgba && type === 'unsigned char') {
          const palette = $(
            '[data-testid="layer-display-controls"] .colormap-control'
          );
          await palette.scrollIntoView({
            block: 'center',
            behavior: 'instant',
          });
          await palette.moveTo();
          const tooltipId = await palette.getAttribute('aria-describedby');
          await expect(
            $(`#${tooltipId}.v-overlay--active .v-overlay__content`)
          ).toHaveText(
            'Color map, range, contrast, and background transparency require a single-component overlay.'
          );
        }

        const opacity = $(
          '[data-testid="layer-opacity-slider"] [role="slider"]'
        );
        await opacity.execute((element) => element.focus());
        await browser.keys(Array.from({ length: 5 }, () => 'PageDown'));
        await expect(opacity).toHaveAttribute('aria-valuenow', '0.5');
        await expectImagePixels(colors(0.5));
        await browser.keys('Home');
        await expect(opacity).toHaveAttribute('aria-valuenow', '0');
        await expectImagePixels(
          [[128, 128, 128]],
          3,
          '[data-testid~="vtk-two-view"]',
          foregroundColors
        );
        await browser.keys(Array.from({ length: 5 }, () => 'PageUp'));
        await expect(opacity).toHaveAttribute('aria-valuenow', '0.5');
        await expectImagePixels(colors(0.5));

        await visibility.click();
        await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
        await expectImagePixels(
          [[128, 128, 128]],
          3,
          '[data-testid~="vtk-two-view"]',
          foregroundColors
        );
        await visibility.click();
        await expect(visibility).toHaveText(expect.stringContaining('HIDE'));
        await expectImagePixels(colors(0.5));

        if (rgba && type === 'unsigned char') {
          await selectLayout('Axial Only', 1, false);
          await expectImagePixels(colors(0.5), 1);
          const saved = await volViewPage.saveSession();
          await waitForDownload(join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
          await openVolViewPage(saved);
          await openLayerDisplayControls();
          await expect(opacity).toHaveAttribute('aria-valuenow', '0.5');
          await expectImagePixels(colors(0.5), 1);
          await selectLayout('Four Up', 3, true);
          await expectImagePixels(colors(0.5));
        }
      });
    }

    it(`preserves native ${type} RGB base colors and visibility across axial and oblique views`, async () => {
      await openVolViewPage(
        writeColorImage(
          `base-${type.replace(' ', '-')}-rgb`,
          nativeColor.map((channel) => channel * scale),
          type
        )
      );
      await selectLayout('Axial Only', 1, false);
      await openBaseControls();
      for (const name of ['colormap', 'range-min', 'range-max'])
        await expect(
          $(`[data-testid="base-image-${name}"] input`)
        ).toBeDisabled();
      await expect($('[data-testid="base-image-contrast"]')).toBeDisabled();
      await expect(
        $('button[data-testid^="control-button-Window & Level"]')
      ).toBeDisabled();
      await expectImagePixels([nativeColor], 1);
      await showOblique();
      await expectImagePixels([nativeColor], 3, obliqueSlices);
      const visibility = $('[data-testid="base-image-visibility"]');
      await expect(visibility).toBeEnabled();
      await visibility.click();
      await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
      await expectImagePixels([[0, 0, 0]], 3, obliqueSlices, [nativeColor]);
      await visibility.click();
      await expectImagePixels([nativeColor], 3, obliqueSlices);
      await selectLayout('Axial Only', 1, false);
      await expectImagePixels([nativeColor], 1);
    });
  }

  it('preserves embedded RGBA base transparency across axial and oblique views', async () => {
    await openVolViewPage(
      writeColorImage(
        'base-rgba-alpha',
        [...nativeColor, 128],
        'unsigned char',
        true
      )
    );
    const colors = [0, 128 / 255, 1].map((alpha) => blendedColor(alpha, 0));
    await selectLayout('Axial Only', 1, false);
    await expectImagePixels(colors, 1);
    await showOblique();
    await expectImagePixels(colors, 3, obliqueSlices);
    await selectLayout('Axial Only', 1, false);
    await expectImagePixels(colors, 1);
  });

  it('uses native RGB colors with the default layer opacity when no display settings are saved', async () => {
    await openOverlayControls('default-rgb-overlay', [180, 0, 0], {
      savedDisplay: false,
    });
    await expect($('[data-testid="layer-colormap"]')).toHaveText(
      expect.stringContaining('2hot-opaque')
    );
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.3');
    await expectImagePixels([[144, 90, 90]]);
  });

  for (const { channels, preset, opacityFunction, expected, mode } of [
    {
      channels: [180, 0, 0],
      preset: '2hot-opaque',
      opacityFunction: {
        mode: 1,
        preset: '2hot-opaque',
        shift: 0,
        shiftAlpha: 0,
      },
      expected: [180, 0, 0],
      mode: 'Points',
    },
    {
      channels: [220, 128],
      preset: 'Grayscale',
      opacityFunction: {
        mode: 2,
        nodes: [
          { x: 0, y: 1, midpoint: 0.5, sharpness: 0 },
          { x: 1, y: 1, midpoint: 0.5, sharpness: 0 },
        ],
      },
      expected: [174, 174, 174],
      mode: 'Nodes',
    },
  ]) {
    it(`restores a saved ${channels.length}-component layer with ${mode} opacity without losing its rendering path`, async () => {
      const base = writeColorImage('legacy-color-base', [128]);
      const overlay = writeColorImage('legacy-color-overlay', channels);
      await writeManifestToFile(
        {
          ...layeredImageManifest(base, overlay),
          layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
          layoutSlots: ['axial'],
          activeView: 'axial',
          viewByID: {
            axial: {
              id: 'axial',
              type: '2D',
              name: 'Axial',
              dataID: 'base',
              options: { orientation: 'Axial' },
              config: {
                base: {
                  window: {
                    width: 255,
                    level: 127.5,
                    auto: 'FullRange',
                    useAuto: false,
                  },
                },
                'base::overlay': {
                  layers: {
                    transferFunction: {
                      preset,
                      mappingRange: [0, 255],
                    },
                    opacityFunction: {
                      ...opacityFunction,
                      mappingRange: [0, 255],
                    },
                    blendConfig: { opacity: 1, visibility: true },
                  },
                },
              },
            },
          },
        },
        'legacy-multicomponent-overlay.json'
      );
      await openVolViewPage('legacy-multicomponent-overlay.json');
      await openLayerDisplayControls();
      await expect($('[data-testid="layer-colormap"]')).toHaveText(
        expect.stringContaining(preset)
      );
      await expectImagePixels([expected], 1);
      const visibility = $('[data-testid="layer-visibility"]');
      await visibility.click();
      await expectImagePixels([[128, 128, 128]], 1);
      await visibility.click();
      await expectImagePixels([expected], 1);
    });
  }
});
