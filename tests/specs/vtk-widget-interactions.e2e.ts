import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import {
  captureViewPixels,
  makeTempDir,
  selectLayout,
  writeManifestToFile,
} from './utils';

const volumeView = '[data-testid~="vtk-volume-view"]';
const coronalView = '.oblique-grid > div:nth-child(1) [data-testid="vtk-view"]';
const sagittalView =
  '.oblique-grid > div:nth-child(3) [data-testid="vtk-view"]';
const axialView = '.oblique-grid > div:nth-child(4) [data-testid="vtk-view"]';
const cropButton = () => $('button[data-testid^="control-button-Crop "]');
const inset = 40;

async function openRamp() {
  const directory = makeTempDir('widget-interactions');
  const header = [
    'NRRD0005',
    'type: short',
    'dimension: 3',
    'sizes: 32 32 32',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ].join('\n');
  const values = Array.from({ length: 32 ** 3 }, (_, index) => {
    const x = index % 32;
    const y = Math.floor(index / 32) % 32;
    const z = Math.floor(index / 1024);
    return 3 * x + 5 * y + 7 * z + (x >= 16 ? 100 : 0);
  }).join(' ');
  writeFileSync(join(directory, 'ramp.nrrd'), `${header}\n\n${values}`);
  await writeManifestToFile(
    {
      windowing: { width: 565, level: 282.5 },
    },
    'widget-interactions-config.json'
  );
  await volViewPage.open(
    '?urls=[tmp/widget-interactions-config.json,tmp/widget-interactions/ramp.nrrd]'
  );
  await volViewPage.waitForViews();
}

const capture = async (selector: string, name: string) =>
  (await captureViewPixels(selector, inset, `${name}.png`))[0];

type Pixels = Awaited<ReturnType<typeof capture>>;

function volumePixels({ data }: Pixels) {
  let foreground = 0;
  let handles = 0;
  for (let index = 0; index < data.length; index += 4) {
    const [red, green, blue] = data.subarray(index, index + 3);
    if (Math.max(red, green, blue) > 35) foreground++;
    if (green > red + 100 && green > blue + 100) handles++;
  }
  return { foreground, handles };
}

function changedGrayPixels(before: Pixels, after: Pixels) {
  if (before.width !== after.width || before.data.length !== after.data.length)
    throw new Error('Expected the view geometry to stay unchanged');
  let count = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    const gray = (data: Buffer) =>
      Math.max(data[index], data[index + 1], data[index + 2]) -
        Math.min(data[index], data[index + 1], data[index + 2]) <
      5;
    if (
      gray(before.data) &&
      gray(after.data) &&
      (before.data[index] > 20 || after.data[index] > 20) &&
      Math.abs(before.data[index] - after.data[index]) > 5
    )
      count++;
  }
  return count;
}

async function drag(
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await browser
    .action('pointer')
    .move({ x: Math.round(from.x), y: Math.round(from.y) })
    .down()
    .move({ x: Math.round(to.x), y: Math.round(to.y) })
    .up()
    .perform();
  await $('header').moveTo();
}

async function cropEdges() {
  return browser.execute(() => {
    const view = document.querySelector('[data-testid~="vtk-two-view"]')!;
    return Array.from(view.querySelectorAll('svg line.pointer-events-all'))
      .map((element) => {
        const line = element as SVGLineElement;
        const start = new DOMPoint(
          line.x1.baseVal.value,
          line.y1.baseVal.value
        ).matrixTransform(line.getScreenCTM()!);
        const end = new DOMPoint(
          line.x2.baseVal.value,
          line.y2.baseVal.value
        ).matrixTransform(line.getScreenCTM()!);
        return {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
          vertical: Math.abs(start.x - end.x) < 1,
        };
      })
      .filter(({ vertical }) => vertical)
      .sort((a, b) => a.x - b.x);
  });
}

function cursorPositions({ width, data }: Pixels) {
  const height = data.length / width / 4;
  const yellowAt = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return (
      data[index] > data[index + 2] + 30 &&
      data[index + 1] > data[index + 2] + 30
    );
  };
  const blueAt = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return data[index + 2] > data[index] + 30;
  };
  const columns = Array.from({ length: width }, (_, x) => {
    let count = 0;
    for (let y = 0; y < height; y++) if (yellowAt(x, y)) count++;
    return count;
  });
  const rows = Array.from({ length: height }, (_, y) => {
    let count = 0;
    for (let x = 0; x < width; x++) if (blueAt(x, y)) count++;
    return count;
  });
  const x = columns.indexOf(Math.max(...columns));
  const y = rows.indexOf(Math.max(...rows));
  const rotationRows = Array.from({ length: height }, (_, row) => {
    let count = 0;
    for (
      let column = Math.max(0, x - 6);
      column <= Math.min(width - 1, x + 6);
      column++
    )
      if (yellowAt(column, row)) count++;
    return { row, count };
  }).filter(({ row, count }) => row < y - 25 && count >= 5);
  const handleY = rotationRows.length
    ? rotationRows.reduce((sum, { row }) => sum + row, 0) / rotationRows.length
    : undefined;
  return {
    x,
    y,
    handleY,
    verticalPixels: columns[x],
    horizontalPixels: rows[y],
  };
}

async function viewportPoint(
  selector: string,
  point: { x: number; y: number }
) {
  const location = await $(selector).getLocation();
  return { x: location.x + inset + point.x, y: location.y + inset + point.y };
}

describe('VTK crop and reslice interactions', () => {
  it('clips the volume when a slice crop edge moves and restores it on reset', async () => {
    await openRamp();
    await selectLayout('Four Up', 3, true);
    await cropButton().click();
    await browser.keys('Escape');
    await browser.waitUntil(async () => (await cropEdges()).length === 2);
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const pixels = volumePixels(await capture(volumeView, 'crop-original'));
      return pixels.foreground > 1000 && pixels.handles > 500;
    });
    const original = volumePixels(
      await capture(volumeView, 'crop-original')
    ).foreground;
    const [left, right] = await cropEdges();
    const destination = { x: left.x + (right.x - left.x) * 0.65, y: left.y };
    await drag(left, destination);
    await browser.waitUntil(
      async () => (await cropEdges())[0].x > left.x + (right.x - left.x) / 2
    );
    await browser.waitUntil(
      async () =>
        volumePixels(await capture(volumeView, 'crop-clipped')).foreground <
        original * 0.8
    );

    await cropButton().click();
    await $('[data-testid="control-button-Reset Crop"]').click();
    await browser.keys('Escape');
    await $('header').moveTo();
    await browser.waitUntil(
      async () => Math.abs((await cropEdges())[0].x - left.x) < 1
    );
    await browser.waitUntil(
      async () =>
        volumePixels(await capture(volumeView, 'crop-reset')).foreground >
        original * 0.95
    );
  });

  it('translates and rotates oblique reslice planes through their rendered handles', async () => {
    await openRamp();
    await volViewPage.layoutButton.click();
    await $('.v-menu.v-overlay--active .v-overlay__content').waitForStable();
    await $('.v-list-item-title=Oblique').waitForClickable();
    await $('.v-list-item-title=Oblique').click();
    await $('.oblique-grid').waitForDisplayed();
    await $('.oblique-grid').waitForStable();
    await $('header').moveTo();
    await browser.waitUntil(async () => {
      const cursor = cursorPositions(
        await capture(coronalView, 'reslice-original')
      );
      return (
        cursor.verticalPixels > 50 &&
        cursor.horizontalPixels > 50 &&
        cursor.handleY !== undefined
      );
    });
    const original = await capture(coronalView, 'reslice-original');
    const sagittal = await capture(sagittalView, 'reslice-sagittal');
    const axial = await capture(axialView, 'reslice-axial');
    const cursor = cursorPositions(original);
    const center = await viewportPoint(coronalView, cursor);
    await drag(center, { x: center.x + 60, y: center.y + 40 });
    await browser.waitUntil(
      async () =>
        changedGrayPixels(
          sagittal,
          await capture(sagittalView, 'reslice-translated-sagittal')
        ) > 1000
    );
    await browser.waitUntil(
      async () =>
        changedGrayPixels(
          axial,
          await capture(axialView, 'reslice-translated-axial')
        ) > 1000
    );

    await $('[data-testid="control-button-Reset Views"]').click();
    await $('header').moveTo();
    await browser.waitUntil(
      async () =>
        changedGrayPixels(
          original,
          await capture(coronalView, 'reslice-reset')
        ) < 20
    );
    const reset = cursorPositions(await capture(coronalView, 'reslice-reset'));
    expect(reset.handleY).toBeDefined();
    const handle = await viewportPoint(coronalView, {
      x: reset.x,
      y: reset.handleY!,
    });
    await drag(handle, { x: handle.x + 35, y: handle.y + 15 });
    await browser.waitUntil(
      async () =>
        changedGrayPixels(
          sagittal,
          await capture(sagittalView, 'reslice-rotated-sagittal')
        ) > 1000
    );
    await browser.waitUntil(
      async () =>
        changedGrayPixels(
          axial,
          await capture(axialView, 'reslice-rotated-axial')
        ) > 1000
    );
  });
});
