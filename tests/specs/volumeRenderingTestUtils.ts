import { step } from './adaptivePresetTrace';
import { volViewPage } from '../pageobjects/volview.page';
import { waitForModuleTransitions } from './utils';

export function createVolumeScalars(
  size: number,
  encoding: 'uint8' | 'uint16' | 'int16' | 'float',
  valueAt: (x: number, y: number, z: number) => number
) {
  const bytes = encoding === 'uint8' ? 1 : encoding === 'float' ? 4 : 2;
  const buffer = Buffer.alloc(size ** 3 * bytes);
  const write = {
    uint8: buffer.writeUInt8.bind(buffer),
    uint16: buffer.writeUInt16LE.bind(buffer),
    int16: buffer.writeInt16LE.bind(buffer),
    float: buffer.writeFloatLE.bind(buffer),
  }[encoding];
  let offset = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        write(valueAt(x, y, z), offset);
        offset += bytes;
      }
    }
  }
  return buffer;
}

export async function openVolumeRenderingControls(tracePrefix?: string) {
  await step(
    tracePrefix && `${tracePrefix}/openVolumeRenderingControls-01`,
    async () => volViewPage.renderingModuleTab.waitForClickable()
  );
  await step(
    tracePrefix && `${tracePrefix}/openVolumeRenderingControls-02`,
    async () => volViewPage.renderingModuleTab.click()
  );
  await step(
    tracePrefix && `${tracePrefix}/openVolumeRenderingControls-03`,
    async () => waitForModuleTransitions()
  );
  const volume = $('[data-testid="volume-rendering-toggle"]');
  if (
    (await step(
      tracePrefix && `${tracePrefix}/openVolumeRenderingControls-04`,
      async () => volume.getAttribute('aria-expanded')
    )) !== 'true'
  )
    await step(
      tracePrefix && `${tracePrefix}/openVolumeRenderingControls-05`,
      async () => volume.click()
    );
  const presets = $('.v-expansion-panel-title*=Color Presets');
  await step(
    tracePrefix && `${tracePrefix}/openVolumeRenderingControls-06`,
    async () => presets.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  if (
    (await step(
      tracePrefix && `${tracePrefix}/openVolumeRenderingControls-07`,
      async () => presets.getAttribute('aria-expanded')
    )) !== 'true'
  )
    await step(
      tracePrefix && `${tracePrefix}/openVolumeRenderingControls-08`,
      async () => presets.click()
    );
  await step(
    tracePrefix && `${tracePrefix}/openVolumeRenderingControls-09`,
    async () => waitForModuleTransitions()
  );
}

export type Appearance = {
  data: number[];
  visible: number;
  colored: number;
  background: number;
};

export async function appearance(): Promise<Appearance> {
  return $('[data-testid~="vtk-volume-view"] canvas').execute((source) => {
    const canvas = source as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = 96;
    copy.height = 96;
    const ctx = copy.getContext('2d')!;
    // Exclude the orientation marker and view annotations at the edges.
    ctx.drawImage(
      canvas,
      canvas.width * 0.15,
      canvas.height * 0.15,
      canvas.width * 0.7,
      canvas.height * 0.7,
      0,
      0,
      copy.width,
      copy.height
    );
    const data = Array.from(ctx.getImageData(0, 0, 96, 96).data);
    let visible = 0;
    let colored = 0;
    let background = 0;
    for (let index = 0; index < data.length; index += 4) {
      const max = Math.max(data[index], data[index + 1], data[index + 2]);
      const min = Math.min(data[index], data[index + 1], data[index + 2]);
      if (max > 25) visible++;
      if (max - min > 15) colored++;
      if (max < 5) background++;
    }
    return { data, visible, colored, background };
  }) as Promise<Appearance>;
}

export function pixelDifference(a: Appearance, b: Appearance, blockSize = 1) {
  let difference = 0;
  let samples = 0;
  for (let y = 0; y < 96; y += blockSize) {
    for (let x = 0; x < 96; x += blockSize) {
      const colors = [a, b].map(({ data }) => {
        const rgb = [0, 0, 0];
        for (let dy = 0; dy < blockSize; dy++) {
          for (let dx = 0; dx < blockSize; dx++) {
            const index = ((y + dy) * 96 + x + dx) * 4;
            for (let channel = 0; channel < 3; channel++)
              rgb[channel] += data[index + channel] / blockSize ** 2;
          }
        }
        return rgb;
      });
      if (Math.max(...colors.flat()) <= 25) continue;
      for (let channel = 0; channel < 3; channel++)
        difference += Math.abs(colors[0][channel] - colors[1][channel]);
      samples += 3;
    }
  }
  return difference / Math.max(1, samples);
}

export async function visibleAppearance(tracePrefix?: string) {
  let result: Appearance;
  await step(tracePrefix && `${tracePrefix}/visibleAppearance-01`, async () =>
    browser.waitUntil(
      async () => {
        result = await step(
          tracePrefix && `${tracePrefix}/visibleAppearance-02`,
          async () => appearance()
        );
        return result.visible > 250 && result.colored < 30;
      },
      {
        timeoutMsg:
          'Expected the adaptive preset to render the generated layers',
      }
    )
  );
  expect(result!.background).toBeGreaterThan(96 * 96 * 0.4);
  return result!;
}

export async function colorShift() {
  const slider = $('[data-testid="volume-color-shift"] [role="slider"]');
  await slider.scrollIntoView({ block: 'center', behavior: 'instant' });
  await slider.waitForDisplayed();
  return slider;
}
