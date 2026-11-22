import fs from 'node:fs';
import path from 'node:path';
import { volViewPage } from '../pageobjects/volview.page';
import {
  captureViewPixels,
  makeTempDir,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

export const VIEW = '[data-testid~="vtk-volume-view"]';

const LAYOUT = {
  layouts: {
    default: {
      direction: 'row',
      items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
    },
  },
};

/** Writes a float NRRD cube with `size` voxels per edge and returns its URL. */
export function writeFloatVolume(
  name: string,
  size: number,
  valueAt: (index: number) => number
) {
  const header = [
    'NRRD0005',
    'type: float',
    'dimension: 3',
    `sizes: ${size} ${size} ${size}`,
    'endian: little',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: raw',
    '',
    '',
  ].join('\n');
  const voxels = Buffer.alloc(size ** 3 * 4);
  for (let index = 0; index < size ** 3; index++)
    voxels.writeFloatLE(valueAt(index), index * 4);
  fs.writeFileSync(
    path.join(makeTempDir(name), `${name}.nrrd`),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return `tmp/${name}/${name}.nrrd`;
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

export async function showColorPresets(show = true) {
  const title = $('.v-expansion-panel-title*=Color Presets');
  await title.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (((await title.getAttribute('aria-expanded')) === 'true') !== show) {
    await title.click();
  }
}

export async function openRenderingModule() {
  await volViewPage.renderingModuleTab.waitForClickable();
  await volViewPage.renderingModuleTab.click();
  await waitForModuleTransitions();
}

export const selectedPreset = () => $('.thumbnail-container.bg-blue');

export async function openWith3DLayout(dataUrl: string, name: string) {
  const config = `${name}-layout.json`;
  await writeManifestToFile(LAYOUT, config);
  await volViewPage.open(`?urls=[tmp/${config},${dataUrl}]`);
  // The load toast covers the lower panel controls, and in an unfocused
  // window its timer and fade-out never finish.
  await browser.execute(() => {
    const style = document.createElement('style');
    style.textContent = '.Vue-Toastification__toast { display: none; }';
    document.head.append(style);
  });
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

/** The fit arrives after loading and narrows the Width bound below twice the data range. */
export async function waitForFittedColorRange(dataRangeWidth: number) {
  const width = sliderThumb('volume-color-width');
  await browser.waitUntil(
    async () =>
      Number(await width.getAttribute('aria-valuemax')) < 2 * dataRangeWidth,
    { timeoutMsg: 'Expected the color range to fit the image statistics' }
  );
}

export async function viewPixels(
  selector: string,
  inset: number,
  file: string
) {
  const [{ data }] = await captureViewPixels(selector, inset, file);
  return data;
}

/** Captures a view until two consecutive frames match. */
export async function stablePixels(selector: string, inset: number) {
  const capture = () => viewPixels(selector, inset, 'stable-pixels.png');
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
