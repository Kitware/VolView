import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { containsText, createVolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createUtils } from './utils';

export const VIEW = '[data-testid~="vtk-volume-view"]';

const LAYOUT = {
  layouts: {
    default: {
      direction: 'row',
      items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
    },
  },
};

/** 1000 at the cube center, falling linearly to 0 at half the edge length. */
export const radialRamp = (size: number) => (index: number) => {
  const offsets = [
    index % size,
    Math.floor(index / size) % size,
    Math.floor(index / size ** 2),
  ].map((c) => c - size / 2);
  return Math.max(0, 1000 * (1 - Math.hypot(...offsets) / (size / 2)));
};

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

export const createVolumeUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);

  /** Writes a float NRRD cube with `size` voxels per edge and returns its URL. */
  const writeFloatVolume = (
    name: string,
    size: number,
    valueAt: (index: number) => number
  ) => {
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
      path.join(utils.makeTempDir(name), `${name}.nrrd`),
      Buffer.concat([Buffer.from(header), voxels])
    );
    return `tmp/${name}/${name}.nrrd`;
  };

  const showColorPresets = async (show = true) => {
    const title = page.locator('.v-expansion-panel-title', {
      hasText: containsText('Color Presets'),
    });
    await title.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    if (((await title.getAttribute('aria-expanded')) === 'true') !== show) {
      await title.click();
    }
  };

  const openRenderingModule = async () => {
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
  };

  const selectedPreset = () => page.locator('.thumbnail-container.bg-blue');

  const openWith3DLayout = async (dataUrl: string, name: string) => {
    const config = `${name}-layout.json`;
    await utils.writeManifestToFile(LAYOUT, config);
    await volview.open(`?urls=[tmp/${config},${dataUrl}]`);
    // The load toast covers the lower panel controls, and in an unfocused
    // window its timer and fade-out never finish.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '.Vue-Toastification__toast { display: none; }';
      document.head.append(style);
    });
    await volview.waitForViewCounts(0, true);
  };

  const sliderThumb = (testId: string) =>
    page.locator(`[data-testid="${testId}"]`).locator('[role="slider"]');

  /** The fit arrives after loading and narrows the Width bound below twice the data range. */
  const waitForFittedColorRange = async (dataRangeWidth: number) => {
    const width = sliderThumb('volume-color-width');
    await expect
      .poll(async () => Number(await width.getAttribute('aria-valuemax')), {
        message: 'Expected the color range to fit the image statistics',
      })
      .toBeLessThan(2 * dataRangeWidth);
  };

  const viewPixels = async (selector: string, inset: number, file: string) => {
    const [{ data }] = await utils.captureViewPixels(selector, inset, file);
    return data;
  };

  /** Captures a view until two consecutive frames match. */
  const stablePixels = async (selector: string, inset: number) => {
    const capture = () => viewPixels(selector, inset, 'stable-pixels.png');
    let previous = await capture();
    await expect
      .poll(async () => {
        const next = await capture();
        const same = next.equals(previous);
        previous = next;
        return same;
      })
      .toBe(true);
    return previous;
  };

  const pressOn = async (slider: Locator, key: string) => {
    // A click can land on a neighboring panel still animating open or closed.
    await slider.focus();
    await page.keyboard.press(key);
  };

  return {
    writeFloatVolume,
    showColorPresets,
    openRenderingModule,
    selectedPreset,
    openWith3DLayout,
    sliderThumb,
    waitForFittedColorRange,
    viewPixels,
    stablePixels,
    pressOn,
  };
};

export type VolumeUtils = ReturnType<typeof createVolumeUtils>;
