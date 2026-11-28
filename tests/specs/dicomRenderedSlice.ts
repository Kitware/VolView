import { expect, type Page } from '@playwright/test';
import type { Utils } from './utils';

export type RenderedSlice = { width: number; height: number; data: Buffer };

// The inset excludes orientation labels, slice counters, sliders and viewport
// controls, so UI text cannot satisfy image assertions.
const VIEW_INSET = 80;

function hasImageContent(
  { width, height, data }: RenderedSlice,
  color = false
) {
  let visible = 0;
  let midtone = 0;
  const tones = new Set<number>();
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const intensity = (red + green + blue) / 3;
    if (!color && Math.max(red, green, blue) - Math.min(red, green, blue) > 3)
      continue;
    if (intensity > 16) visible++;
    if (intensity > 32 && intensity < 224) midtone++;
    tones.add(Math.floor(intensity / 16));
  }
  const count = width * height;
  return (
    visible > count * 0.01 &&
    visible < count * 0.9 &&
    midtone > count * 0.003 &&
    tones.size >= 5
  );
}

function imageChanged(before: RenderedSlice, after: RenderedSlice) {
  if (before.width !== after.width || before.height !== after.height)
    return false;
  let changed = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    const delta =
      Math.abs(before.data[index] - after.data[index]) +
      Math.abs(before.data[index + 1] - after.data[index + 1]) +
      Math.abs(before.data[index + 2] - after.data[index + 2]);
    if (delta >= 24) changed++;
  }
  return changed > before.width * before.height * 0.002;
}

export const createRenderedSlice = (page: Page, utils: Utils) => {
  const captureSlice = async (fileName: string) => {
    const [view] = await utils.captureViewPixels(
      '[data-testid~="vtk-two-view"]',
      VIEW_INSET,
      fileName
    );
    if (!view) throw new Error('No slice viewport');
    return { ...view, height: view.data.length / 4 / view.width };
  };

  const waitForRenderedSlice = async (fileName: string, color = false) => {
    await page.locator('header').hover();
    let image: RenderedSlice | undefined;
    await expect
      .poll(
        async () => {
          image = await captureSlice(fileName);
          return hasImageContent(image, color);
        },
        {
          message: `Expected anatomical ${color ? 'color' : 'grayscale'} content inside the slice viewport`,
        }
      )
      .toBe(true);
    return image!;
  };

  const waitForRenderedSliceChange = async (
    before: RenderedSlice,
    fileName: string
  ) => {
    await page.locator('header').hover();
    await expect
      .poll(
        async () => {
          const after = await captureSlice(fileName);
          return hasImageContent(after) && imageChanged(before, after);
        },
        {
          message:
            'Expected slice navigation to change the interior image pixels',
        }
      )
      .toBe(true);
  };

  return { waitForRenderedSlice, waitForRenderedSliceChange };
};
