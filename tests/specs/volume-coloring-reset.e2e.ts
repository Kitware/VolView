import { volViewPage } from '../pageobjects/volview.page';
import { captureViewPixels, waitForModuleTransitions } from './utils';
import {
  floatVoxels,
  nrrd,
  openWith3DLayout,
  writeNrrd,
} from './volumeTestUtils';

const SIZE = 16;
const EDITOR = '[data-testid="volume-opacity-editor"]';
const RESET = '[data-testid="volume-reset-color-opacity"]';

const thumb = (slider: string) => $(slider).$('[role="slider"]');
const shiftThumb = () => thumb('[data-testid="volume-color-shift"]');
const widthThumb = () => thumb('[data-testid="volume-color-width"]');
const ambientThumb = () => $('.v-slider*=Ambient').$('[role="slider"]');
const sliderValue = async (slider: ChainablePromiseElement) =>
  String(await slider.getAttribute('aria-valuenow'));

async function pixels(selector: string, inset: number, file: string) {
  const [{ data }] = await captureViewPixels(selector, inset, file);
  return data;
}

function differingFraction(a: Buffer, b: Buffer) {
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

async function waitForPixels(
  selector: string,
  inset: number,
  expected: Buffer,
  matches: boolean,
  timeoutMsg: string
) {
  await browser.waitUntil(
    async () => {
      const fraction = differingFraction(
        await pixels(selector, inset, 'volume-coloring-reset.png'),
        expected
      );
      return matches ? fraction < 0.01 : fraction > 0.05;
    },
    { timeoutMsg }
  );
}

async function stablePixels(selector: string, inset: number) {
  let previous = await pixels(selector, inset, 'volume-coloring-stable.png');
  await browser.waitUntil(async () => {
    const next = await pixels(selector, inset, 'volume-coloring-stable.png');
    const same = next.equals(previous);
    previous = next;
    return same;
  });
  return previous;
}

async function pressOn(slider: ChainablePromiseElement, key: string) {
  await slider.scrollIntoView({ block: 'center', behavior: 'instant' });
  await slider.click();
  await browser.keys(key);
}

async function dragOpacityCurve(steps: number) {
  const editor = $(EDITOR).$('canvas');
  await editor.scrollIntoView({ block: 'center', behavior: 'instant' });
  const drag = browser
    .action('pointer')
    .move({ origin: editor, x: -60, y: 0 })
    .down();
  for (let step = 0; step < steps; step++)
    drag.move({ origin: 'pointer', x: 30, y: 0, duration: 50 });
  await drag.up().perform();
}

describe('3D rendering color and opacity reset', () => {
  it('restores Shift, Width, and the opacity curve while keeping lighting', async () => {
    const name = 'volume-coloring-reset';
    const voxels = floatVoxels(SIZE, (index) => {
      const offsets = [
        index % SIZE,
        Math.floor(index / SIZE) % SIZE,
        Math.floor(index / SIZE ** 2),
      ].map((c) => c - SIZE / 2);
      return Math.max(0, 1000 * (1 - Math.hypot(...offsets) / (SIZE / 2)));
    });
    await openWith3DLayout(
      writeNrrd(name, nrrd([], 'float', SIZE), voxels),
      name
    );
    await volViewPage.renderingModuleTab.waitForClickable();
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    const reset = $(RESET);
    await expect(reset).toBeEnabled();
    await expect(reset).toHaveAttribute(
      'aria-label',
      'Reset color and opacity'
    );

    // A gaussian stays highlighted once clicked, so select it before the baseline.
    await dragOpacityCurve(0);
    await pressOn(ambientThumb(), 'ArrowRight');
    await expect(ambientThumb()).toHaveAttribute('aria-valuenow', '0.3');

    const shift = await sliderValue(shiftThumb());
    const width = await sliderValue(widthThumb());
    // The editor draws both the opacity curve and the color bar for Shift and Width.
    const editor = await stablePixels(EDITOR, 0);

    await dragOpacityCurve(3);
    await waitForPixels(
      EDITOR,
      0,
      editor,
      false,
      'Expected dragging to change the opacity curve'
    );
    await pressOn(shiftThumb(), 'End');
    await pressOn(widthThumb(), 'Home');
    await expect(shiftThumb()).not.toHaveAttribute('aria-valuenow', shift);
    await expect(widthThumb()).not.toHaveAttribute('aria-valuenow', width);

    await browser.keys('Tab');
    await expect(reset).toBeFocused();
    await browser.keys('Enter');

    await expect(shiftThumb()).toHaveAttribute('aria-valuenow', shift);
    await expect(widthThumb()).toHaveAttribute('aria-valuenow', width);
    await waitForPixels(
      EDITOR,
      0,
      editor,
      true,
      'Expected reset to restore the opacity curve and color bar'
    );
    await expect(ambientThumb()).toHaveAttribute('aria-valuenow', '0.3');
  });
});
