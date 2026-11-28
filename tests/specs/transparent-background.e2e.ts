import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText, setValueVueInput } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import type { Utils } from './utils';

function writeImages(scratch: Scratch) {
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
    scratch.writeFile(name, `${header}\n\n${values.join(' ')}`);
  }
}

const captureViews = (utils: Utils) =>
  utils.capture2DViewPixels(50, 'transparent-capture.png');

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

async function setOpacity(page: Page, utils: Utils, percent: number) {
  const slider = page.locator(
    '[data-testid="layer-opacity-slider"] [role="slider"]'
  );
  await slider.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await slider.focus();
  await page.keyboard.press('Home');
  for (let value = 0; value < percent; value += 10)
    await page.keyboard.press('PageUp');
  await expect(
    page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
  ).toHaveAttribute('aria-valuenow', String(percent / 100));
  await utils.moveToElement(page.locator('header'));
}

test.describe('Transparent overlay background', () => {
  test('preserves anatomy below Min and fades only the first 10% of a signed fractional range in every view', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    writeImages(scratch);
    await utils.writeManifestToFile(
      {
        io: { layerExtension: 'layer' },
        windowing: { width: 255, level: 127.5 },
      },
      'transparent-config.json'
    );
    await volview.open(
      '?urls=[tmp/transparent-config.json,tmp/transparent-base.nrrd,tmp/transparent-base.layer.nrrd]'
    );
    await volview.waitForViews();
    await volview.waitForViewCounts(3, true);
    await volview.renderingModuleTab.click();
    for (const title of ['Color Presets', 'Cinematic Rendering']) {
      const section = page.locator('.v-expansion-panel-title', {
        hasText: containsText(title),
      });
      if ((await section.getAttribute('aria-expanded')) === 'true')
        await section.click();
    }
    const toggle = page.locator(
      '[data-testid="layer-transparent-background"] input'
    );
    await expect(toggle).toBeChecked();
    await expect(page.locator('[data-testid="layer-colormap"]')).toContainText(
      'DICOM Hot Iron'
    );
    await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
    const rangeMin = page.locator('[data-testid="layer-range-min"] input');
    await rangeMin.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await setValueVueInput(rangeMin, '-2.75');
    await setValueVueInput(
      page.locator('[data-testid="layer-range-max"] input'),
      '7.25'
    );
    await setOpacity(page, utils, 0);
    let base: ViewPixels = [];
    await expect
      .poll(
        async () => {
          base = await captureViews(utils);
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
          message:
            'Expected both gray anatomy regions in every view at zero overlay opacity',
        }
      )
      .toBe(true);
    const scrollToggle = () =>
      toggle.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
    await scrollToggle();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await setOpacity(page, utils, 100);
    let opaque: ViewPixels = [];
    let groups: number[][][] = [];
    await expect
      .poll(
        async () => {
          opaque = await captureViews(utils);
          groups = matchingPixels(base, opaque);
          return (
            groups.length === 3 &&
            groups.every((view) =>
              view.every((indices) => indices.length > 100)
            )
          );
        },
        {
          message:
            'Expected the below-Min, halfway-fade and above-fade regions in every view',
        }
      )
      .toBe(true);
    await setOpacity(page, utils, 50);
    await expect
      .poll(
        async () =>
          matchesBlend(
            base,
            opaque,
            await captureViews(utils),
            groups,
            [0.5, 0.5, 0.5]
          ),
        {
          message:
            'Expected 50% straight blending while transparent background is off',
        }
      )
      .toBe(true);
    await scrollToggle();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () =>
          matchesBlend(
            base,
            opaque,
            await captureViews(utils),
            groups,
            [0, 0.25, 0.5]
          ),
        {
          message:
            'Expected unchanged anatomy below Min, half the selected opacity halfway through the fade, and selected opacity above it in all views',
        }
      )
      .toBe(true);
    await scrollToggle();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await utils.moveToElement(page.locator('header'));
    await expect
      .poll(
        async () =>
          matchesBlend(
            base,
            opaque,
            await captureViews(utils),
            groups,
            [0.5, 0.5, 0.5]
          ),
        {
          message:
            'Expected switching transparent background off to restore straight blending in all views',
        }
      )
      .toBe(true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
