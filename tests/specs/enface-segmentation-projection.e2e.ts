import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { test, expect, registerOctTestHooks } from '../fixtures';
import { createNrrdVolume, createVtiVolume } from '../fixtures/oct/volumes';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Utils } from './utils';
import { PANEL, type OctUtils } from './octTestUtils';

const SIZE = 12;
const STEM = 'enface-footprints-' + process.pid;
const [RED_NAME, BLUE_NAME] = ['Red columns', 'Blue columns'];
const RED = [2, 3] as const;
const BLUE = [7, 8] as const;
const OVERLAP = [4, 6] as const;
const DEEP = [9, 2] as const;
const EMPTY = [10, 10] as const;
type PixelKind = 'gray' | 'red' | 'blue' | 'overlap';
type Sample = readonly [readonly [number, number], PixelKind];

const maskValues = (inside: (x: number, y: number, z: number) => boolean) =>
  Uint16Array.from({ length: SIZE ** 3 }, (_, index) =>
    Number(
      inside(
        index % SIZE,
        Math.floor(index / SIZE) % SIZE,
        Math.floor(index / SIZE ** 2)
      )
    )
  );

async function openFootprintScene(
  volview: VolViewPage,
  utils: Utils,
  oct: OctUtils
) {
  const directory = utils.makeTempDir(STEM);
  fs.writeFileSync(
    path.join(directory, 'parent.vti'),
    createVtiVolume({
      values: new Uint16Array(SIZE ** 3).fill(100),
      dimensions: [SIZE, SIZE, SIZE],
      type: 'UInt16',
    })
  );
  const zip = new JSZip();
  const masks = [
    {
      id: 'red',
      name: RED_NAME,
      color: [255, 0, 0, 255],
      values: maskValues(
        (x, y, z) => x >= 1 && x <= 5 && y >= 1 && y <= 5 && z >= 2 && z <= 8
      ),
    },
    {
      id: 'blue',
      name: BLUE_NAME,
      color: [0, 0, 255, 255],
      values: maskValues(
        (x, y, z) =>
          (x >= 4 && x <= 8 && y >= 6 && y <= 10 && z >= 5 && z <= 10) ||
          (x >= 8 && x <= 10 && y >= 9 && y <= 10 && z >= 1 && z <= 3)
      ),
    },
  ];
  masks.forEach(({ id, values }) =>
    zip.file(
      `${id}.nrrd`,
      createNrrdVolume({
        dimensions: [SIZE, SIZE, SIZE],
        spacing: [1, 1, 1],
        scalars: values,
      })
    )
  );
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${STEM}/parent.vti` }],
      segments: masks.map(({ id, name, color }) => ({ id, name, color })),
      selectedSegment: 'red',
      segmentations: [
        {
          id: 'segmentation',
          name: 'Columns',
          parentImage: '0',
          fillOpacity: 0.5,
          outlineOpacity: 0,
          outlineThickness: 0,
          order: masks.map(({ id }) => `${id}-mask`),
          masks: masks.map(({ id }) => ({
            id: `${id}-mask`,
            segmentId: id,
            representations: {
              labelmap: {
                path: `${id}.nrrd`,
                extent: [0, SIZE - 1, 0, SIZE - 1, 0, SIZE - 1],
              },
            },
          })),
        },
      ],
      viewByID: {
        enface: {
          id: 'enface',
          name: 'En face',
          type: 'EnFace',
          dataID: '0',
          config: {
            '0': {
              enFace: {
                axis: 1,
                method: 'mean',
                depthStart: 0,
                depthEnd: null,
              },
            },
          },
        },
      },
      layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
      layoutSlots: ['enface'],
      activeView: 'enface',
    })
  );
  fs.writeFileSync(
    path.join(directory, 'columns.volview.zip'),
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  await volview.open(`?urls=[tmp/${STEM}/columns.volview.zip]`);
  await oct.waitForEnFaceReady();
  await oct.setEnFaceWindow(200, 100);
  await oct.openEnFaceControls();
}

function pixelMatches([red, green, blue]: number[], kind: PixelKind) {
  const matches = {
    gray: red > 20 && red === green && green === blue,
    red: red > green + 30 && red > blue + 30,
    blue: blue > red + 30 && blue > green + 30,
    overlap: red > green + 20 && blue > green + 20,
  };
  return matches[kind];
}

async function expectPixels(oct: OctUtils, samples: readonly Sample[]) {
  await oct.waitForEnFaceReady();
  await expect
    .poll(
      async () => {
        const matches = await Promise.all(
          samples.map(async ([point, kind]) =>
            pixelMatches(await oct.enFacePixel(...point), kind)
          )
        );
        return matches.every(Boolean);
      },
      {
        message: `Expected projected segmentation pixels: ${JSON.stringify(samples)}`,
      }
    )
    .toBe(true);
}

test.describe('En face segmentation projections', () => {
  registerOctTestHooks();

  test('draws shown segments where they cross the slab, with overlaps', async ({
    page,
    volview,
    utils,
    oct,
    segmentation,
  }) => {
    await openFootprintScene(volview, utils, oct);
    await expectPixels(oct, [
      [RED, 'gray'],
      [BLUE, 'gray'],
      [OVERLAP, 'gray'],
    ]);
    await oct.setSegmentShown(RED_NAME, true);
    await expectPixels(oct, [
      [RED, 'red'],
      [BLUE, 'gray'],
    ]);
    await oct.setSegmentShown(BLUE_NAME, true);
    await expectPixels(oct, [
      [RED, 'red'],
      [BLUE, 'blue'],
      [OVERLAP, 'overlap'],
      [DEEP, 'blue'],
      [EMPTY, 'gray'],
    ]);

    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(6, 8);
    await expectPixels(oct, [
      [RED, 'gray'],
      [BLUE, 'blue'],
      [OVERLAP, 'blue'],
      [DEEP, 'gray'],
    ]);
    await oct.setSlabRange(0, 11);

    const all = page
      .locator(PANEL)
      .locator('[data-testid="enface-segments-visible"]');
    await expect(all).toHaveAttribute('aria-label', 'Hide every segment');
    await all.click();
    await expectPixels(oct, [
      [RED, 'gray'],
      [BLUE, 'gray'],
    ]);
    await all.click();
    await expectPixels(oct, [
      [RED, 'red'],
      [OVERLAP, 'overlap'],
    ]);

    await page.keyboard.press('Escape');
    await segmentation.openAnnotationSegments();
    await segmentation.setSegmentVisible(RED_NAME, false);
    await expectPixels(oct, [
      [RED, 'gray'],
      [OVERLAP, 'blue'],
      [BLUE, 'blue'],
    ]);
    await segmentation.setSegmentVisible(RED_NAME, true);
    await expectPixels(oct, [
      [RED, 'red'],
      [OVERLAP, 'overlap'],
    ]);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('highlights thin regions of two segments against their own thresholds', async ({
    volview,
    utils,
    oct,
  }) => {
    await openFootprintScene(volview, utils, oct);
    await oct.setSegmentShown(BLUE_NAME, true);
    // Red is 5000 um deep; blue is 5000 um deep except its 2000 um corner.
    await oct.setSegmentThreshold(RED_NAME, 4000);
    await expectPixels(oct, [
      [RED, 'gray'],
      [OVERLAP, 'blue'],
      [BLUE, 'blue'],
      [DEEP, 'blue'],
    ]);
    await oct.setSegmentThreshold(BLUE_NAME, 3000);
    await expectPixels(oct, [
      [RED, 'gray'],
      [BLUE, 'gray'],
      [DEEP, 'blue'],
    ]);
    await oct.setSegmentThreshold(RED_NAME, 6000);
    await expectPixels(oct, [
      [RED, 'red'],
      [OVERLAP, 'red'],
      [BLUE, 'gray'],
      [DEEP, 'blue'],
    ]);
    await expect(oct.segmentThreshold(RED_NAME)).toHaveValue('6000');
    await expect(oct.segmentThreshold(BLUE_NAME)).toHaveValue('3000');
    await oct.setSegmentThreshold(RED_NAME, 4000);
    await expectPixels(oct, [[RED, 'gray']]);
    await oct.setSegmentThreshold(RED_NAME, null);
    await expect(oct.segmentThreshold(RED_NAME)).toHaveValue('');
    await expectPixels(oct, [
      [RED, 'red'],
      [BLUE, 'gray'],
      [DEEP, 'blue'],
    ]);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('shares segment settings with Rendering controls and restores them from a session', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    await openFootprintScene(volview, utils, oct);
    await oct.expandEnFaceSection('projection');
    await oct.setSlabRange(1, 8);
    await oct.setSegmentShown(BLUE_NAME, true);
    await oct.setSegmentThreshold(RED_NAME, 4000);
    await expectPixels(oct, [
      [RED, 'gray'],
      [BLUE, 'blue'],
      [DEEP, 'gray'],
    ]);

    const sidebar = await oct.openEnFaceSidebarControls();
    await oct.expandEnFaceSection('segments', sidebar);
    const expectSettings = async (scope?: string) => {
      for (const name of [BLUE_NAME, RED_NAME])
        await expect(oct.segmentEye(name, scope)).toHaveAttribute(
          'aria-pressed',
          'true'
        );
      await expect(oct.segmentThreshold(RED_NAME, scope)).toHaveValue('4000');
      await expect(oct.segmentThreshold(BLUE_NAME, scope)).toHaveValue('');
    };
    await expectSettings(sidebar);
    await oct.setSegmentShown(BLUE_NAME, false, sidebar);
    await expectPixels(oct, [[BLUE, 'gray']]);
    await oct.openEnFaceControls();
    await expect(oct.segmentEye(BLUE_NAME)).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await oct.setSegmentShown(BLUE_NAME, true);
    await page.keyboard.press('Escape');

    const saved = await volview.saveSession();
    await volview.open(`?urls=[tmp/${saved}]`);
    await oct.waitForEnFaceReady();
    await expectPixels(oct, [
      [RED, 'gray'],
      [BLUE, 'blue'],
      [DEEP, 'gray'],
    ]);
    await oct.openEnFaceControls();
    await expectSettings();
    await oct.setSegmentShown(BLUE_NAME, false);
    await expectPixels(oct, [[BLUE, 'gray']]);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
