import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { FIXTURES } from '../../wdio.shared.conf';
import { publicOCTGrid, publicOCTVolume } from '../fixtures/oct/volumes';

export function stageGenericOCT(
  directory: string,
  format: 'nrrd' | 'nii' | 'vti',
  unitsKnown = true
) {
  const source = path.join(FIXTURES, 'oct', 'retina-derived.dcm');
  const name =
    'retina-public' + (unitsKnown ? '' : '-unknown-units') + '.' + format;
  let bytes: Buffer;
  if (format === 'vti') {
    const volume = publicOCTGrid(source);
    const [width, frames, depth] = volume.dimensions;
    const spacing = [...volume.spacing];
    spacing[0] *= -1;
    bytes = Buffer.from(
      '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">' +
        '<ImageData WholeExtent="0 ' +
        (width - 1) +
        ' 0 ' +
        (frames - 1) +
        ' 0 ' +
        (depth - 1) +
        '" Origin="0 0 0" Spacing="' +
        spacing.join(' ') +
        '">' +
        '<Piece Extent="0 ' +
        (width - 1) +
        ' 0 ' +
        (frames - 1) +
        ' 0 ' +
        (depth - 1) +
        '"><PointData Scalars="intensity">' +
        '<DataArray type="UInt16" Name="intensity" format="ascii">' +
        Array.from(volume.scalars).join(' ') +
        '</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>'
    );
  } else bytes = publicOCTVolume(source, format, unitsKnown);
  fs.writeFileSync(path.join(directory, name), bytes);
  return name;
}

// A display illustration with a localized thin patch, never clinical ground truth.
// This matches tests/fixtures/oct/illustrative.py without requiring Python at runtime.
export function stageIllustrativeMask(
  directory: string,
  size: number[],
  spacing: number[]
) {
  const [width, depth, frames] = size;
  const mask = Buffer.alloc(width * depth * frames);
  for (let z = 0; z < frames; z++) {
    for (let x = 0; x < width; x++) {
      const bottom = Math.round(
        145 +
          26 * Math.sin((Math.PI * x) / (width - 1)) +
          2 * Math.sin((Math.PI * z) / (frames - 1))
      );
      const thin = ((x - 76) / 12) ** 2 + ((z - 16) / 3) ** 2 <= 1;
      const thickness = thin ? 2 : 5;
      for (let y = bottom - thickness + 1; y <= bottom; y++)
        mask[(z * depth + y) * width + x] = 1;
    }
  }
  const [sx, sy, sz] = spacing;
  const header = [
    'NRRD0005',
    'type: unsigned char',
    'dimension: 3',
    'sizes: ' + width + ' ' + depth + ' ' + frames,
    'space: left-posterior-superior',
    'space directions: (' + sx + ',0,0) (0,' + sy + ',0) (0,0,' + sz + ')',
    'space origin: (0,0,0)',
    'Segment0_LabelValue:=1',
    'Segment0_Name:=Synthetic retinal layer',
    'Segment0_Color:=0.13725490196078433 0.8431372549019608 0.7450980392156863',
    'encoding: gzip',
    '',
    '',
  ].join('\n');
  const name = 'illustrative-layer.nrrd';
  fs.writeFileSync(
    path.join(directory, name),
    Buffer.concat([Buffer.from(header), gzipSync(mask)])
  );
  return name;
}
// Independently counted by the Python generator from the same known voxel geometry.
export const ILLUSTRATIVE_THIN_COLUMNS = 107;

async function sourceMaskPixels() {
  return browser.execute(() => {
    const source = document.querySelector<HTMLCanvasElement>(
      'div[data-testid~="vtk-two-view"] canvas'
    );
    if (!source) throw new Error('Original OCT canvas is missing');
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('Source canvas copy has no 2D context');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    let colored = 0;
    let gray = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 1] > pixels[i] + 12 && pixels[i + 2] > pixels[i] + 10)
        colored++;
      if (
        pixels[i] > 20 &&
        pixels[i] === pixels[i + 1] &&
        pixels[i] === pixels[i + 2]
      )
        gray++;
    }
    return { colored, gray };
  });
}

export async function expectStackedSourceMask() {
  await browser.waitUntil(async () => (await sourceMaskPixels()).colored > 100);
  expect((await sourceMaskPixels()).gray).toBeGreaterThan(1000);
  const bounds = await browser.execute(() => {
    const source = document
      .querySelector('div[data-testid~="vtk-two-view"]')
      ?.closest('.vtk-container-wrapper');
    const enface = document.querySelector('[data-testid="oct-en-face-viewer"]');
    if (!source || !enface)
      throw new Error('The stacked OCT views are missing');
    const top = source.getBoundingClientRect();
    const bottom = enface.getBoundingClientRect();
    return {
      sourceBottom: top.bottom,
      enfaceTop: bottom.top,
      sourceWidth: top.width,
      enfaceWidth: bottom.width,
      sourceLeft: top.left,
      enfaceLeft: bottom.left,
    };
  });
  expect(bounds.sourceBottom).toBeLessThanOrEqual(bounds.enfaceTop + 2);
  expect(bounds.sourceWidth).toBeGreaterThan(1000);
  expect(bounds.enfaceWidth).toBeCloseTo(bounds.sourceWidth, 0);
  expect(bounds.enfaceLeft).toBeCloseTo(bounds.sourceLeft, 0);
}

export async function expectControlsBesideSelector() {
  const bounds = await browser.execute(() => {
    const viewer = document.querySelector('[data-testid="oct-en-face-viewer"]');
    const button = viewer?.querySelector(
      '[data-testid="oct-en-face-controls"]'
    );
    const selector = viewer?.querySelector('.view-type-select');
    const canvas = viewer?.querySelector('canvas');
    const panel = document.querySelector('[data-testid="oct-rendering-panel"]');
    if (!button || !selector || !canvas || !panel)
      throw new Error('En face controls or image are missing');
    const tune = button.getBoundingClientRect();
    const select = selector.getBoundingClientRect();
    return {
      gap: select.left - tune.right,
      panelLeft: panel.getBoundingClientRect().left,
      imageRight: canvas.getBoundingClientRect().right,
    };
  });
  expect(bounds.gap).toBeGreaterThanOrEqual(0);
  expect(bounds.gap).toBeLessThan(12);
  expect(bounds.panelLeft).toBeGreaterThanOrEqual(bounds.imageRight);
}

const CANVAS = '[data-testid="oct-en-face-canvas"]';
const STATE = '[data-testid="oct-en-face-state"]';

export async function readEnFacePixels(points: { x: number; z: number }[]) {
  return browser.execute(
    (selector, coordinates) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('OCT projection canvas has no 2D context');
      return coordinates.map(({ x, z }) =>
        Array.from(context.getImageData(x, z, 1, 1).data)
      );
    },
    CANVAS,
    points
  );
}

export async function getEnFaceWindow() {
  return {
    width: Number(await $(STATE).getAttribute('data-window-width')),
    level: Number(await $(STATE).getAttribute('data-window-level')),
  };
}

function grayPixel(value: number, window: { width: number; level: number }) {
  const intensity = Math.round(
    Math.min(
      1,
      Math.max(0, (value - (window.level - window.width / 2)) / window.width)
    ) * 255
  );
  return [intensity, intensity, intensity, 255];
}

export async function expectEnFacePixels(
  values: number[],
  points: { x: number; z: number }[]
) {
  await browser.waitUntil(
    async () => {
      const window = await getEnFaceWindow();
      const expected = values.map((value) => grayPixel(value, window));
      const actual = await readEnFacePixels(points);
      return JSON.stringify(actual) === JSON.stringify(expected);
    },
    {
      timeoutMsg:
        'Expected independently calculated real OCT projection pixels',
    }
  );
}

export async function expectEnFaceDisabledInSwitcher(reason: string) {
  const switcher = (await $$('.view-type-select .v-field'))[0];
  await switcher.click();
  const option = $(
    '//div[contains(@class, "v-overlay--active")]//div[contains(@class, "v-list-item") and normalize-space(.)="En face"]'
  );
  await option.waitForDisplayed();
  expect(await option.getAttribute('class')).toContain('v-list-item--disabled');
  expect(await option.getText()).toContain('En face');
  expect(
    await option.execute((element) =>
      element.parentElement?.getAttribute('title')
    )
  ).toContain(reason);
}
