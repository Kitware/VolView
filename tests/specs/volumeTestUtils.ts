import fs from 'node:fs';
import path from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import { captureViewPixels, makeTempDir, writeManifestToFile } from './utils';

const LAYOUT = {
  layouts: {
    default: {
      direction: 'row',
      items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
    },
  },
};

export const nrrd = (fields: string[], type = 'uchar', size = 8) =>
  [
    'NRRD0005',
    `type: ${type}`,
    'dimension: 3',
    `sizes: ${size} ${size} ${size}`,
    'endian: little',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: raw',
    ...fields,
    '',
    '',
  ].join('\n');

export function floatVoxels(size: number, valueAt: (index: number) => number) {
  const buffer = Buffer.alloc(size ** 3 * 4);
  for (let index = 0; index < size ** 3; index++)
    buffer.writeFloatLE(valueAt(index), index * 4);
  return buffer;
}

/** 1000 at the cube center, falling linearly to 0 at half the edge length. */
export const radialRamp = (size: number) => (index: number) => {
  const offsets = [
    index % size,
    Math.floor(index / size) % size,
    Math.floor(index / size ** 2),
  ].map((c) => c - size / 2);
  return Math.max(0, 1000 * (1 - Math.hypot(...offsets) / (size / 2)));
};

export function writeNrrd(name: string, header: string, voxels: Buffer) {
  const directory = makeTempDir(name);
  fs.writeFileSync(
    path.join(directory, `${name}.nrrd`),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return `tmp/${name}/${name}.nrrd`;
}

export async function openWith3DLayout(dataUrl: string, name: string) {
  const config = `${name}-layout.json`;
  await writeManifestToFile(LAYOUT, config);
  await volViewPage.open(`?urls=[tmp/${config},${dataUrl}]`);
  await volViewPage.waitForViewCounts(0, true);
}

/** Fraction of RGBA pixels whose largest channel difference exceeds 8. */
export function differingFraction(a: Buffer, b: Buffer) {
  let differing = 0;
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(
      Math.abs(a[index] - b[index]),
      Math.abs(a[index + 1] - b[index + 1]),
      Math.abs(a[index + 2] - b[index + 2])
    );
    if (delta > 8) differing++;
  }
  return differing / (a.length / 4);
}

export const sliderThumb = (testId: string) =>
  $(`[data-testid="${testId}"]`).$('[role="slider"]');

/** Captures a view until two consecutive frames match. */
export async function stablePixels(selector: string, inset: number) {
  const capture = async () =>
    (await captureViewPixels(selector, inset, 'stable-pixels.png'))[0].data;
  let previous = await capture();
  await browser.waitUntil(async () => {
    const next = await capture();
    const same = next.equals(previous);
    previous = next;
    return same;
  });
  return previous;
}

export async function pressOn(slider: ChainablePromiseElement, key: string) {
  await slider.scrollIntoView({ block: 'center', behavior: 'instant' });
  await slider.click();
  await browser.keys(key);
}
