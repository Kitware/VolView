import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layeredImageManifest } from './layerDisplayTestUtils';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  capture2DViewPixels,
  makeTempDir,
  openVolViewPage,
  selectLayout,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

function writeColorImage(
  name: string,
  channels: number[],
  type = 'unsigned char'
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
  const values = Array.from({ length: 4096 }, (_, index) =>
    channels.length === 1 && (index === 0 || index === 4095)
      ? String(index === 0 ? 0 : 255)
      : channels.join(' ')
  ).join(' ');
  writeFileSync(join(directory, `${name}.nrrd`), `${header}\n\n${values}`);
  return `${name}/${name}.nrrd`;
}

async function openControls() {
  await volViewPage.renderingModuleTab.click();
  const volume = $('[data-testid="volume-rendering-toggle"]');
  if (await volume.isExisting()) await volume.click();
  await waitForModuleTransitions();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
}

const pixels = () => capture2DViewScreenshotMetrics('native-color-display.png');

async function expectNativeColor(expected: number[], count: number) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const views = await capture2DViewPixels(40, 'native-color-channels.png');
      return (
        views.length === count &&
        views.every(({ data }) => {
          let matching = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (
              expected.every(
                (value, channel) => Math.abs(data[i + channel] - value) <= 2
              )
            )
              matching++;
          }
          return matching > 1000;
        })
      );
    },
    {
      timeoutMsg: `Expected substantial native image pixels with RGB ${expected.join(', ')}`,
    }
  );
}

describe('Native color display controls', () => {
  for (const [type, channels] of [
    ['unsigned char', [180, 30, 60]],
    ['unsigned short', [46260, 7710, 15420]],
    ['float', [180 / 255, 30 / 255, 60 / 255]],
  ] as const) {
    it(`renders a ${type} RGB base in its native colors with scalar controls disabled`, async () => {
      await openVolViewPage(
        writeColorImage(
          `native-rgb-${type.replace(' ', '-')}`,
          [...channels],
          type
        )
      );
      await selectLayout('Axial Only', 1, false);
      await openControls();
      await expect(
        $('[data-testid="base-image-colormap"] input')
      ).toBeDisabled();
      await expect(
        $('[data-testid="base-image-range-min"] input')
      ).toBeDisabled();
      await expect(
        $('[data-testid="base-image-range-max"] input')
      ).toBeDisabled();
      await expect($('[data-testid="base-image-contrast"]')).toBeDisabled();
      await $('header').moveTo();
      await expectNativeColor([180, 30, 60], 1);
      const visibility = $('[data-testid="base-image-visibility"]');
      await expect(visibility).toBeEnabled();
      await visibility.click();
      await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
      await $('header').moveTo();
      await browser.waitUntil(async () => (await pixels())[0].colored < 1000);
      await visibility.click();
      await expect(visibility).toHaveText(expect.stringContaining('HIDE'));
      await $('header').moveTo();
      await expectNativeColor([180, 30, 60], 1);
    });
  }

  it('keeps RGBA overlay opacity and visibility usable without applying a scalar palette', async () => {
    const base = writeColorImage('native-color-base', [128]);
    const rgba = writeColorImage('native-rgba', [0, 0, 220, 128]);
    await writeManifestToFile(
      {
        ...layeredImageManifest(base, rgba),
        layerDisplay: {
          'base::overlay': {
            preset: 'DICOM Hot Iron',
            mappingRange: [0, 255],
            opacity: 1,
            transparentBackground: false,
          },
        },
      },
      'native-color-overlay.json'
    );
    await openVolViewPage('native-color-overlay.json');
    await $(`.image-list-card*=${base.split('/').at(-1)}`)
      .$('[data-testid="dataset-menu-button"]')
      .click();
    await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
    await $('.v-list-item*=Show in all views').click();
    await browser.keys('Escape');
    await openControls();
    for (const name of ['colormap', 'range-min', 'range-max'])
      await expect($(`[data-testid="layer-${name}"] input`)).toBeDisabled();
    await expect($('[data-testid="layer-contrast"]')).toBeDisabled();
    await expect($('[data-testid="layer-opacity-slider"] input')).toBeEnabled();
    const visible = $('[data-testid="layer-visibility"]');
    await expect(visible).toBeEnabled();
    await setValueVueInput(
      $('[data-testid="base-image-range-min"] input'),
      '0'
    );
    await setValueVueInput(
      $('[data-testid="base-image-range-max"] input'),
      '255'
    );
    const blended = (opacity: number) => {
      const alpha = (128 / 255) * opacity;
      return [0, 0, 220].map((channel) =>
        Math.round(channel * alpha + 128 * (1 - alpha))
      );
    };
    await expectNativeColor(blended(1), 3);
    const opacity = $('[data-testid="layer-opacity-slider"] [role="slider"]');
    await opacity.execute((element) => element.focus());
    await browser.keys('Home');
    await expect(opacity).toHaveAttribute('aria-valuenow', '0');
    await expectNativeColor([128, 128, 128], 3);
    await opacity.execute((element) => element.focus());
    await browser.keys(Array.from({ length: 50 }, () => 'ArrowRight'));
    await expect(opacity).toHaveAttribute('aria-valuenow', '0.5');
    await expectNativeColor(blended(0.5), 3);
    await visible.click();
    await expect(visible).toHaveText(expect.stringContaining('SHOW'));
    await expectNativeColor([128, 128, 128], 3);
    await visible.click();
    await expect(visible).toHaveText(expect.stringContaining('HIDE'));
    await expectNativeColor(blended(0.5), 3);
  });
});
