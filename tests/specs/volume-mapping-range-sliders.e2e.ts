import { volViewPage } from '../pageobjects/volview.page';
import { waitForModuleTransitions } from './utils';
import {
  differingFraction,
  floatVoxels,
  nrrd,
  openWith3DLayout,
  pressOn,
  radialRamp,
  sliderThumb,
  stablePixels,
  writeNrrd,
} from './volumeTestUtils';

const SIZE = 16;
const VIEW = '[data-testid~="vtk-volume-view"]';

const ramp = radialRamp(SIZE);
const VOLUMES: [string, (index: number) => number][] = [
  ['normalized with a far outlier', (i) => (i === 0 ? 1000 : ramp(i) / 1000)],
  ['spanning 0 to 0.01', (i) => ramp(i) / 1e5],
  ['in Hounsfield units', (i) => (ramp(i) > 300 ? 700 : ramp(i) ? 40 : -1024)],
];

async function slider(testId: string) {
  const thumb = sliderThumb(testId);
  const [min, max, now] = await Promise.all(
    ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map(async (name) =>
      Number(await thumb.getAttribute(name))
    )
  );
  return { thumb, min, max, now };
}

describe('3D rendering Shift and Width sliders', () => {
  VOLUMES.forEach(([label, valueAt], index) => {
    it(`edit the color range of a volume ${label}`, async () => {
      const name = `volume-mapping-range-${index}`;
      await openWith3DLayout(
        writeNrrd(name, nrrd([], 'float', SIZE), floatVoxels(SIZE, valueAt)),
        name
      );
      await volViewPage.renderingModuleTab.waitForClickable();
      await volViewPage.renderingModuleTab.click();
      await waitForModuleTransitions();

      const shift = await slider('volume-color-shift');
      const width = await slider('volume-color-width');
      expect(shift.now).toBe(0);
      expect(width.min).toBeLessThan(width.now);
      expect(width.max / width.now).toBeCloseTo(2, 6);

      const before = await stablePixels(VIEW, 40);
      await pressOn(width.thumb, 'Home');
      const narrowed = await slider('volume-color-width');
      expect(narrowed.now).toBe(narrowed.min);
      expect(narrowed.now).toBeLessThan(width.now / 100);
      expect(
        differingFraction(before, await stablePixels(VIEW, 40))
      ).toBeGreaterThan(0.05);

      await pressOn(shift.thumb, 'ArrowRight');
      const shifted = await slider('volume-color-shift');
      expect(shifted.now).toBeGreaterThan(0);
      expect(shifted.now).toBeLessThanOrEqual(width.now / 128);
    });
  });
});
