import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setValueVueInput } from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  openLayerDisplayControls,
} from './layerDisplayTestUtils';
import { makeTempDir, openVolViewPage, writeManifestToFile } from './utils';

function writeFractionalImage(name: string, peaks: [number, number]) {
  const directory = makeTempDir(name);
  const header = [
    'NRRD0005',
    'type: float',
    'dimension: 3',
    'sizes: 16 16 16',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ].join('\n');
  const values = Array.from({ length: 4096 }, (_, index) => {
    if (index === 0) return 0;
    if (index === 4095) return 1;
    return peaks[index % 4 === 0 ? 1 : 0];
  }).join(' ');
  writeFileSync(join(directory, `${name}.nrrd`), `${header}\n\n${values}`);
  return `${name}/${name}.nrrd`;
}

const control = (id: string) => $(`[data-testid="${id}"]`);

async function histogramShape(prefix: string, peaks: number[]) {
  return browser.execute(
    (selector: string, positions: number[]) => {
      const svg = document.querySelector<SVGSVGElement>(selector)!;
      const path = svg.querySelector('path')!;
      const inside = (fraction: number, height: number) =>
        path.isPointInFill(
          new DOMPoint(fraction * svg.viewBox.baseVal.width, height)
        );
      return {
        major: inside(positions[0], 1),
        wideMajor: inside(positions[0] + 0.01, 1),
        minor: inside(positions[1], 13),
        minorTall: inside(positions[1], 8),
        empty: inside(0.37, 14.5),
        middle: inside(0.5, 14.5),
      };
    },
    `[data-testid="${prefix}-histogram"]`,
    peaks
  );
}

describe('Image histograms in display range bars', () => {
  it('positions fractional base and overlay peaks on the fixed image axis without intercepting range edits', async () => {
    const base = writeFractionalImage('histogram-base', [0.125, 0.625]);
    const overlay = writeFractionalImage('histogram-overlay', [0.25, 0.75]);
    await writeManifestToFile(
      layeredImageManifest(base, overlay),
      'histogram.json'
    );
    await openVolViewPage('histogram.json');
    await $('.image-list-card*=histogram-base.nrrd')
      .$('[data-testid="dataset-menu-button"]')
      .click();
    const show = $('.v-list-item*=Show in all views');
    await show.waitForClickable();
    await show.click();
    await browser.keys('Escape');
    await openLayerDisplayControls();

    for (const [prefix, peaks, bar] of [
      ['base-image-range', [0.127, 0.627], 'base-image-range-bar'],
      ['layer-range', [0.252, 0.752], 'palette-window-bar'],
    ] as const) {
      const histogram = control(`${prefix}-histogram`);
      await histogram.waitForDisplayed();
      await expect(histogram).toHaveAttribute('aria-hidden', 'true');
      expect((await histogram.getCSSProperty('pointer-events')).value).toBe(
        'none'
      );
      await browser.waitUntil(
        async () => {
          const shape = await histogramShape(prefix, [...peaks]);
          return (
            shape.major &&
            shape.wideMajor &&
            shape.minor &&
            !shape.minorTall &&
            !shape.empty &&
            !shape.middle
          );
        },
        {
          timeoutMsg: `Expected fractional peaks with a 3:1 height ratio in ${prefix}`,
        }
      );
      const originalPath = await histogram.$('path').getAttribute('d');
      expect((await control(bar).getSize()).height).toBe(32);
      await setValueVueInput(control(`${prefix}-min`).$('input'), '0.05');
      await setValueVueInput(control(`${prefix}-max`).$('input'), '0.9');
      const handle = control(`${prefix}-min-handle`);
      await expect(handle).toBeEnabled();
      const previous = await handle.getAttribute('aria-valuenow');
      await handle.execute((element) => element.focus());
      await browser.keys('ArrowRight');
      await expect(handle).not.toHaveAttribute('aria-valuenow', previous!);
      expect(await histogram.$('path').getAttribute('d')).toBe(originalPath);
      expect((await control(bar).getSize()).height).toBe(32);
    }
  });
});
