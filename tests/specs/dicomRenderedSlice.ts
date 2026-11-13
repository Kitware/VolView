import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { TEMP_DIR } from '../../wdio.shared.conf';

type RenderedSlice = { width: number; height: number; data: Buffer };

async function captureSlice(fileName: string, viewIndex: number) {
  const image = PNG.sync.read(
    await browser.saveScreenshot(resolve(TEMP_DIR, fileName))
  );
  const geometry = await browser.execute((index) => {
    const view = document.querySelectorAll('[data-testid~="vtk-two-view"]')[
      index
    ];
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }, viewIndex);
  if (!geometry) throw new Error(`No slice viewport at index ${viewIndex}`);
  const scaleX = image.width / geometry.viewportWidth;
  const scaleY = image.height / geometry.viewportHeight;
  const left = Math.ceil((geometry.x + geometry.width * 0.18) * scaleX);
  const top = Math.ceil((geometry.y + geometry.height * 0.18) * scaleY);
  const width = Math.floor(geometry.width * 0.64 * scaleX);
  const height = Math.floor(geometry.height * 0.64 * scaleY);
  if (
    width <= 0 ||
    height <= 0 ||
    left < 0 ||
    top < 0 ||
    left + width > image.width ||
    top + height > image.height
  )
    throw new Error('The slice viewport has no interior image region');
  // The central image region excludes orientation labels, slice counters,
  // sliders and viewport controls, so UI text cannot satisfy image assertions.
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const source = ((top + row) * image.width + left) * 4;
    image.data.copy(data, row * width * 4, source, source + width * 4);
  }
  return { width, height, data };
}

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

export async function waitForRenderedSlice(
  fileName: string,
  viewIndex = 0,
  color = false
) {
  await $('header').moveTo();
  let image: RenderedSlice | undefined;
  await browser.waitUntil(
    async () => {
      image = await captureSlice(fileName, viewIndex);
      return hasImageContent(image, color);
    },
    {
      timeoutMsg: `Expected anatomical ${color ? 'color' : 'grayscale'} content inside the slice viewport`,
    }
  );
  return image!;
}

export async function waitForRenderedSliceChange(
  before: RenderedSlice,
  fileName: string,
  viewIndex = 0
) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => {
      const after = await captureSlice(fileName, viewIndex);
      return hasImageContent(after) && imageChanged(before, after);
    },
    {
      timeoutMsg:
        'Expected slice navigation to change the interior image pixels',
    }
  );
}
