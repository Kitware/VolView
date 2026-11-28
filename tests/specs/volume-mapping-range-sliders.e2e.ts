import { test, expect } from '../fixtures';
import {
  differingFraction,
  radialRamp,
  VIEW,
  type VolumeUtils,
} from './volumeTestUtils';

const SIZE = 16;

const ramp = radialRamp(SIZE);
const VOLUMES: [string, (index: number) => number][] = [
  ['normalized with a far outlier', (i) => (i === 0 ? 1000 : ramp(i) / 1000)],
  ['spanning 0 to 0.01', (i) => ramp(i) / 1e5],
  ['in Hounsfield units', (i) => (ramp(i) > 300 ? 700 : ramp(i) ? 40 : -1024)],
];

async function slider(volume: VolumeUtils, testId: string) {
  const thumb = volume.sliderThumb(testId);
  const [min, max, now] = await Promise.all(
    ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map(async (name) =>
      Number(await thumb.getAttribute(name))
    )
  );
  return { thumb, min, max, now };
}

test.describe('3D rendering Shift and Width sliders', () => {
  VOLUMES.forEach(([label, valueAt], index) => {
    test(`edit the color range of a volume ${label}`, async ({ volume }) => {
      const name = `volume-mapping-range-${index}`;
      await volume.openWith3DLayout(
        volume.writeFloatVolume(name, SIZE, valueAt),
        name
      );
      await volume.openRenderingModule();

      const shift = await slider(volume, 'volume-color-shift');
      const width = await slider(volume, 'volume-color-width');
      expect(shift.now).toBe(0);
      expect(width.min).toBeLessThan(width.now);
      expect(width.max / width.now).toBeCloseTo(2, 6);

      const before = await volume.stablePixels(VIEW, 40);
      await volume.pressOn(width.thumb, 'Home');
      const narrowed = await slider(volume, 'volume-color-width');
      expect(narrowed.now).toBe(narrowed.min);
      expect(narrowed.now).toBeLessThan(width.now / 100);
      await expect
        .poll(
          async () =>
            differingFraction(before, await volume.stablePixels(VIEW, 40)),
          { message: 'Expected Home on Width to narrow the 3D render' }
        )
        .toBeGreaterThan(0.05);

      await volume.pressOn(shift.thumb, 'ArrowRight');
      const shifted = await slider(volume, 'volume-color-shift');
      expect(shifted.now).toBeGreaterThan(0);
      expect(shifted.now).toBeLessThanOrEqual(width.now / 128);
    });
  });
});
