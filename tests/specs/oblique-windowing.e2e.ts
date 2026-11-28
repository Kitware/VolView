import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import {
  canvasAppearance,
  displayedWindow,
  stageGenericOCT,
  WINDOW_TOOL,
} from './octTestUtils';

const OBLIQUE_CHILD =
  '.oblique-grid > .d-flex:first-child [data-testid="vtk-view"]';
const SOURCE_PEER = '[data-testid~="vtk-two-view"]';

test.describe('Oblique source windowing', () => {
  test('synchronizes a live Oblique child drag with source peers and toolbar fields', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const directory = 'oblique-windowing';
    const image = stageGenericOCT(utils.makeTempDir(directory), 'nrrd');
    await utils.writeManifestToFile(
      { windowing: { width: 1000, level: 500 } },
      directory + '-config.json'
    );
    await volview.open(
      '?urls=[tmp/' +
        directory +
        '/' +
        image +
        ',tmp/' +
        directory +
        '-config.json]'
    );
    await volview.waitForViews();
    await volview.waitForViewCounts(3, true);
    await page.locator('.view-type-select .v-field').nth(0).click();
    await utils.overlayOption('Oblique').click();

    const child = page.locator(OBLIQUE_CHILD).first();
    const canvas = child.locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toBeEnabled();
    const peer = page.locator(SOURCE_PEER).first();
    const peerCanvas = peer.locator('canvas');
    await expect
      .poll(async () => (await canvasAppearance(peerCanvas)).visiblePixels, {
        message: 'The scalar source peer must render visible image pixels',
      })
      .toBeGreaterThan(100);
    const before = await displayedWindow(child);
    expect(before).toEqual({ width: 1000, level: 500 });
    const beforeImage = (await canvasAppearance(peerCanvas)).image;
    await volview.openMenu(page.locator(WINDOW_TOOL));
    await volview.closeMenu(page.locator(WINDOW_TOOL));
    await oct.dragContrast(canvas, 35, 25, { position: { x: 0.25, y: 0.25 } });
    let observed = before;
    await expect
      .poll(
        async () => {
          observed = await displayedWindow(child);
          return (
            observed.width !== before.width && observed.level !== before.level
          );
        },
        {
          message: 'The live Oblique child must respond to the windowing drag',
        }
      )
      .toBe(true)
      .catch((error: Error) => {
        error.message +=
          '; initial ' +
          JSON.stringify(before) +
          '; observed ' +
          JSON.stringify(observed);
        throw error;
      });
    const changed = await displayedWindow(child);
    await expect
      .poll(
        async () => {
          const synchronized = await displayedWindow(peer);
          return (
            synchronized.width === changed.width &&
            synchronized.level === changed.level
          );
        },
        {
          message:
            'The source peer must match the live Oblique child W/L ' +
            JSON.stringify(changed),
        }
      )
      .toBe(true);
    await expect
      .poll(async () => (await canvasAppearance(peerCanvas)).image, {
        message:
          'Synchronized windowing must change the source image rendering',
      })
      .not.toBe(beforeImage);

    await page.locator(WINDOW_TOOL).click();
    const inputs = page.locator('.v-overlay--active .manual-inputs input');
    await expect(inputs.nth(0)).toBeVisible();
    expect(Number(await inputs.nth(0).inputValue())).toBe(
      Number(changed.width.toPrecision(4))
    );
    expect(Number(await inputs.nth(1).inputValue())).toBe(
      Number(changed.level.toPrecision(4))
    );
  });
});

test.describe('Shared Oblique slab sampling', () => {
  for (const scenario of [
    {
      name: 'coarse',
      spacing: 1,
      values: [40, 40, 40, 200, 40, 200, 40, 40, 40],
      expected: 120,
    },
    {
      name: 'fine',
      spacing: 0.5,
      values: [40, 40, 40, 200, 40, 200, 40, 40, 40],
      expected: 200,
    },
    {
      name: 'submillimeter',
      spacing: 0.25,
      values: [40, 40, 40, 40, 40, 40, 40, 200, 40],
      expected: 40,
    },
  ]) {
    test(
      'keeps the existing 1 mm Maximum slab for ' + scenario.name + ' voxels',
      async ({ page, volview, utils }) => {
        const stem = 'oblique-slab-' + scenario.name;
        const name = 'source.nrrd';
        fs.writeFileSync(
          path.join(utils.makeTempDir(stem), name),
          createNrrdVolume({
            scalars: Uint16Array.from(
              { length: 5 * 9 * 5 },
              (_, index) => scenario.values[Math.floor(index / 5) % 9]
            ),
            dimensions: [5, 9, 5],
            spacing: Array(3).fill(scenario.spacing),
          })
        );
        await utils.writeManifestToFile(
          {
            layouts: { 'Oblique sampling': [['oblique']] },
            windowing: { width: 255, level: 127.5 },
          },
          stem + '.json'
        );
        await volview.open(
          '?urls=[tmp/' + stem + '.json,tmp/' + stem + '/' + name + ']'
        );
        const canvas = page.locator(OBLIQUE_CHILD).first().locator('canvas');
        await expect(canvas).toBeVisible();
        await expect
          .poll(async () => {
            const pixel = await canvas.evaluate((element) => {
              const source = element as HTMLCanvasElement;
              const context = document
                .createElement('canvas')
                .getContext('2d')!;
              context.canvas.width = source.width;
              context.canvas.height = source.height;
              context.drawImage(source, 0, 0);
              return Array.from(
                context.getImageData(
                  Math.floor(source.width * 0.6),
                  Math.floor(source.height * 0.6),
                  1,
                  1
                ).data
              );
            });
            return (
              pixel[3] === 255 &&
              pixel
                .slice(0, 3)
                .every((channel) => Math.abs(channel - scenario.expected) <= 1)
            );
          })
          .toBe(true);
        expect(await volview.getNotificationsCount()).toBe(0);
      }
    );
  }
});
