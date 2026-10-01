import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

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
