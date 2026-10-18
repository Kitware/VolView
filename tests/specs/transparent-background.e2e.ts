import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { capture2DViewPixels, writeManifestToFile } from './utils';

function writeImages() {
  const header = [
    'NRRD0005',
    'type: float',
    'dimension: 3',
    'sizes: 32 32 32',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ].join('\n');
  for (const overlay of [false, true]) {
    const values = Array.from({ length: 32 ** 3 }, (_, index) => {
      const coordinates = [
        index % 32,
        Math.floor(index / 32) % 32,
        Math.floor(index / 1024),
      ];
      const sum = (size: number) =>
        coordinates.reduce(
          (total, coordinate) => total + Math.floor(coordinate / size),
          0
        );
      return overlay
        ? [-3.25, -2.75, -2.25, 2.25][sum(8) % 4]
        : [80, 180][sum(4) % 2];
    });
    const name = overlay
      ? 'transparent-base.layer.nrrd'
      : 'transparent-base.nrrd';
    writeFileSync(join(TEMP_DIR, name), `${header}\n\n${values.join(' ')}`);
  }
}

const captureViews = () => capture2DViewPixels(50, 'transparent-capture.png');

type ViewPixels = Awaited<ReturnType<typeof captureViews>>;

function matchingPixels(base: ViewPixels, opaque: ViewPixels) {
  return base.map((view, viewIndex) => {
    const full = opaque[viewIndex];
    const groups: number[][] = [[], [], []];
    for (
      let i = (view.width + 1) * 4;
      i < view.data.length - (view.width + 1) * 4;
      i += 4
    ) {
      const gray = view.data[i];
      const color = full.data.slice(i, i + 3);
      const [red, green, blue] = color;
      const group = [
        red <= 1 && green <= 1 && blue <= 1,
        red >= 24 && red <= 28 && green <= 2 && blue <= 2,
        red >= 253 && green <= 2 && blue <= 2,
      ].findIndex(Boolean);
      if (group < 0 || ![80, 180].some((value) => Math.abs(gray - value) <= 1))
        continue;
      const same = [
        -view.width - 1,
        -view.width,
        -view.width + 1,
        -1,
        0,
        1,
        view.width - 1,
        view.width,
        view.width + 1,
      ].every((offset) =>
        [0, 1, 2].every(
          (channel) =>
            view.data[i + offset * 4 + channel] === gray &&
            full.data[i + offset * 4 + channel] === color[channel]
        )
      );
      if (same) groups[group].push(i);
    }
    return groups;
  });
}

function matchesBlend(
  base: ViewPixels,
  opaque: ViewPixels,
  actual: ViewPixels,
  groups: number[][][],
  alphas: number[]
) {
  return (
    actual.length === 3 &&
    actual.every((view, viewIndex) =>
      groups[viewIndex].every(
        (indices, group) =>
          indices.length > 100 &&
          indices.every((index) =>
            [0, 1, 2].every((channel) => {
              const expected =
                base[viewIndex].data[index + channel] * (1 - alphas[group]) +
                opaque[viewIndex].data[index + channel] * alphas[group];
              return Math.abs(view.data[index + channel] - expected) <= 2;
            })
          )
      )
    )
  );
}

async function setOpacity(percent: number) {
  const slider = $('[data-testid="layer-opacity-slider"] [role="slider"]');
  await slider.scrollIntoView({ block: 'center', behavior: 'instant' });
  await slider.execute((element) => element.focus());
  await browser.keys('Home');
  for (let value = 0; value < percent; value += 10)
    await browser.keys('PageUp');
  await expect(
    $('[data-testid="layer-opacity-slider"] [role="slider"]')
  ).toHaveAttribute('aria-valuenow', String(percent / 100));
  await $('header').moveTo();
}

describe('Transparent overlay background', () => {
  it('preserves anatomy below Min and fades only the first 10% of a signed fractional range in every view', async () => {
    writeImages();
    await writeManifestToFile(
      {
        io: { layerExtension: 'layer' },
        windowing: { width: 255, level: 127.5 },
      },
      'transparent-config.json'
    );
    await volViewPage.open(
      '?urls=[tmp/transparent-config.json,tmp/transparent-base.nrrd,tmp/transparent-base.layer.nrrd]'
    );
    await volViewPage.waitForViews();
    await volViewPage.waitForViewCounts(3, true);
    await volViewPage.renderingModuleTab.click();
    for (const title of ['Color Presets', 'Cinematic Rendering']) {
      const section = $(`.v-expansion-panel-title*=${title}`);
      if ((await section.getAttribute('aria-expanded')) === 'true')
        await section.click();
    }
    const toggle = $('[data-testid="layer-transparent-background"] input');
    await expect(toggle).toBeChecked();
    await expect($('[data-testid="layer-colormap"]')).toHaveText(
      expect.stringContaining('DICOM Hot Iron')
    );
    await browser.waitUntil(
      async () => (await $$('.Vue-Toastification__toast').length) === 0
    );
    await $('[data-testid="layer-range-min"] input').scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    await setValueVueInput($('[data-testid="layer-range-min"] input'), '-2.75');
    await setValueVueInput($('[data-testid="layer-range-max"] input'), '7.25');
    await setOpacity(0);
    let base: ViewPixels = [];
    await browser.waitUntil(
      async () => {
        base = await captureViews();
        return (
          base.length === 3 &&
          base.every(({ data }) =>
            [80, 180].every(
              (gray) =>
                data.filter(
                  (value, index) =>
                    index % 4 === 0 &&
                    Math.abs(value - gray) <= 1 &&
                    data[index + 1] === value &&
                    data[index + 2] === value
                ).length > 500
            )
          )
        );
      },
      {
        timeoutMsg:
          'Expected both gray anatomy regions in every view at zero overlay opacity',
      }
    );
    await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await setOpacity(100);
    let opaque: ViewPixels = [];
    let groups: number[][][] = [];
    await browser.waitUntil(
      async () => {
        opaque = await captureViews();
        groups = matchingPixels(base, opaque);
        return (
          groups.length === 3 &&
          groups.every((view) => view.every((indices) => indices.length > 100))
        );
      },
      {
        timeoutMsg:
          'Expected the below-Min, halfway-fade and above-fade regions in every view',
      }
    );
    await setOpacity(50);
    await browser.waitUntil(
      async () =>
        matchesBlend(
          base,
          opaque,
          await captureViews(),
          groups,
          [0.5, 0.5, 0.5]
        ),
      {
        timeoutMsg:
          'Expected 50% straight blending while transparent background is off',
      }
    );
    await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await $('header').moveTo();
    await browser.waitUntil(
      async () =>
        matchesBlend(
          base,
          opaque,
          await captureViews(),
          groups,
          [0, 0.25, 0.5]
        ),
      {
        timeoutMsg:
          'Expected unchanged anatomy below Min, half the selected opacity halfway through the fade, and selected opacity above it in all views',
      }
    );
    await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await $('header').moveTo();
    await browser.waitUntil(
      async () =>
        matchesBlend(
          base,
          opaque,
          await captureViews(),
          groups,
          [0.5, 0.5, 0.5]
        ),
      {
        timeoutMsg:
          'Expected switching transparent background off to restore straight blending in all views',
      }
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
