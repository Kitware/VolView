import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { createNrrdVolume, createVtiVolume } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  makeTempDir,
  overlayOption,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
} from './utils';
import {
  PANEL,
  enFacePixel,
  expandEnFaceSection,
  openEnFaceControls,
  openEnFaceSidebarControls,
  selectSetting,
  setEnFaceWindow,
  setSlabRange,
  waitForEnFaceReady,
} from './octTestUtils';
import { registerOctTestHooks } from './octInteractionTestUtils';
import { openAnnotationSegments, segmentRow } from './segmentationTestUtils';

const SIZE = 12;
const STEM = 'enface-footprints-' + process.pid;
const SEGMENTS = ['Red columns', 'Blue columns'];
const RED = [2, 3] as const;
const BLUE = [7, 8] as const;
const OVERLAP = [4, 6] as const;
const DEEP = [9, 2] as const;
const EMPTY = [10, 10] as const;
const TOGGLE = '[data-testid="enface-footprints-toggle"]';
const SELECTION = '[data-testid="enface-footprint-segments"]';
const SCOPE = 'enface-footprint-scope';
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

async function openFootprintScene() {
  const directory = makeTempDir(STEM);
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
      name: SEGMENTS[0],
      color: [255, 0, 0, 255],
      values: maskValues(
        (x, y, z) => x >= 1 && x <= 5 && y >= 1 && y <= 5 && z >= 2 && z <= 8
      ),
    },
    {
      id: 'blue',
      name: SEGMENTS[1],
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
                highlightThin: true,
                thresholdMicrons: 1000,
                segmentId: 'red',
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
  await volViewPage.open(`?urls=[tmp/${STEM}/columns.volview.zip]`);
  await waitForEnFaceReady();
  await setEnFaceWindow(200, 100);
  await openEnFaceControls();
}

async function openFootprintSection(scope = PANEL) {
  const section = $(scope).$(
    '[data-testid="enface-footprints-section-toggle"]'
  );
  await section.scrollIntoView({ block: 'center', behavior: 'instant' });
  await section.waitForClickable();
  if ((await section.getAttribute('aria-expanded')) !== 'true')
    await section.click();
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  await section.$('..').waitForStable();
}

async function setFootprints(enabled: boolean, scope = PANEL) {
  await openFootprintSection(scope);
  const toggle = $(scope).$(TOGGLE);
  await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
  await expect(toggle.$('input')).toBeEnabled();
  if ((await toggle.$('input').isSelected()) !== enabled)
    await toggle.$('label').click();
  if (enabled) await expect(toggle.$('input')).toBeSelected();
  else await expect(toggle.$('input')).not.toBeSelected();
}

async function setProjectedSegments(names: string[], scope = PANEL) {
  await openFootprintSection(scope);
  const selector = $(scope).$(SELECTION);
  await selector.scrollIntoView({ block: 'center', behavior: 'instant' });
  await selector.waitForClickable();
  await selector.click();
  for (const name of SEGMENTS) {
    const option = overlayOption(name);
    await option.waitForClickable();
    if (
      ((await option.getAttribute('aria-selected')) === 'true') !==
      names.includes(name)
    )
      await option.click();
  }
  await browser.keys('Escape');
  await overlayOption(SEGMENTS[0]).waitForDisplayed({ reverse: true });
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

async function expectPixels(samples: readonly Sample[]) {
  await waitForEnFaceReady();
  await browser.waitUntil(
    async () => {
      const matches = await Promise.all(
        samples.map(async ([point, kind]) =>
          pixelMatches(await enFacePixel(...point), kind)
        )
      );
      return matches.every(Boolean);
    },
    {
      timeoutMsg: `Expected projected segmentation pixels: ${JSON.stringify(samples)}`,
    }
  );
}

describe('En face segmentation projections', () => {
  registerOctTestHooks();

  it('projects tall columns, overlaps and deep objects with slab and visibility controls', async () => {
    await openFootprintScene();
    await expectPixels([
      [RED, 'gray'],
      [BLUE, 'gray'],
      [DEEP, 'gray'],
    ]);
    await setFootprints(true);
    await setProjectedSegments(SEGMENTS);
    await expectPixels([
      [RED, 'red'],
      [BLUE, 'blue'],
      [OVERLAP, 'overlap'],
      [DEEP, 'blue'],
      [EMPTY, 'gray'],
    ]);

    await expandEnFaceSection('projection');
    await setSlabRange(1, 8);
    await expectPixels([
      [RED, 'red'],
      [BLUE, 'blue'],
      [DEEP, 'gray'],
    ]);
    await openFootprintSection();
    await selectSetting(SCOPE, 'Entire volume');
    await expectPixels([[DEEP, 'blue']]);
    await selectSetting(SCOPE, 'Current slab');
    await expectPixels([[DEEP, 'gray']]);

    await browser.keys('Escape');
    await openAnnotationSegments();
    const red = await segmentRow(SEGMENTS[0]);
    await red.$('button:has(i.mdi-eye)').click();
    await expectPixels([
      [RED, 'gray'],
      [OVERLAP, 'blue'],
      [BLUE, 'blue'],
    ]);
    await red.$('button:has(i.mdi-eye-off)').click();
    await expectPixels([
      [RED, 'red'],
      [OVERLAP, 'overlap'],
    ]);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('shares selection and scope with Rendering controls and restores them from a session', async () => {
    await openFootprintScene();
    await setFootprints(true);
    await setProjectedSegments([SEGMENTS[1]]);
    await expandEnFaceSection('projection');
    await setSlabRange(1, 8);
    await openFootprintSection();
    await selectSetting(SCOPE, 'Entire volume');
    await expectPixels([
      [RED, 'gray'],
      [BLUE, 'blue'],
      [DEEP, 'blue'],
    ]);

    const sidebar = await openEnFaceSidebarControls();
    await openFootprintSection(sidebar);
    await expect($(sidebar).$(TOGGLE + ' input')).toBeSelected();
    await expect($(sidebar).$(SELECTION)).toHaveText(
      expect.stringContaining(SEGMENTS[1])
    );
    await expect($(sidebar).$(`[data-testid="${SCOPE}"] input`)).toHaveValue(
      'Entire volume'
    );
    await setFootprints(false, sidebar);
    await expectPixels([
      [BLUE, 'gray'],
      [DEEP, 'gray'],
    ]);
    await openEnFaceControls();
    await openFootprintSection();
    await expect($(PANEL).$(TOGGLE + ' input')).not.toBeSelected();
    await setFootprints(true);
    await browser.keys('Escape');

    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open(`?urls=[tmp/${saved}]`);
    await waitForEnFaceReady();
    await expectPixels([
      [RED, 'gray'],
      [BLUE, 'blue'],
      [DEEP, 'blue'],
    ]);
    await openEnFaceControls();
    await openFootprintSection();
    await expect($(PANEL).$(TOGGLE + ' input')).toBeSelected();
    await expect($(PANEL).$(SELECTION)).toHaveText(
      expect.stringContaining(SEGMENTS[1])
    );
    await expect($(PANEL).$(`[data-testid="${SCOPE}"] input`)).toHaveValue(
      'Entire volume'
    );
    await selectSetting(SCOPE, 'Current slab');
    await expectPixels([
      [BLUE, 'blue'],
      [DEEP, 'gray'],
    ]);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
