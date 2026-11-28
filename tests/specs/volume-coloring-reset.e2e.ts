import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText } from '../pageobjects/volview.page';
import {
  differingFraction,
  radialRamp,
  type VolumeUtils,
} from './volumeTestUtils';

const SIZE = 16;
const EDITOR = '[data-testid="volume-opacity-editor"]';
const RESET = '[data-testid="volume-reset-color-opacity"]';

const shiftThumb = (volume: VolumeUtils) =>
  volume.sliderThumb('volume-color-shift');
const widthThumb = (volume: VolumeUtils) =>
  volume.sliderThumb('volume-color-width');
const ambientThumb = (page: Page) =>
  page
    .locator('.v-slider', { hasText: containsText('Ambient') })
    .first()
    .locator('[role="slider"]');
const sliderValue = async (slider: Locator) =>
  String(await slider.getAttribute('aria-valuenow'));

async function waitForPixels(
  volume: VolumeUtils,
  expected: Buffer,
  matches: boolean,
  timeoutMsg: string
) {
  await expect
    .poll(
      async () => {
        const fraction = differingFraction(
          await volume.viewPixels(EDITOR, 0, 'volume-coloring-reset.png'),
          expected
        );
        return matches ? fraction < 0.01 : fraction > 0.05;
      },
      { message: timeoutMsg }
    )
    .toBe(true);
}

async function dragOpacityCurve(page: Page, steps: number) {
  const editor = page.locator(EDITOR).locator('canvas').first();
  await editor.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  const box = await editor.boundingBox();
  if (!box) throw new Error('The opacity editor is not on screen');
  let x = Math.round(box.x + box.width / 2) - 60;
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 0; step < steps; step++) {
    x += 30;
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}

test.describe('3D rendering color and opacity reset', () => {
  test('restores Shift, Width, and the opacity curve while keeping lighting', async ({
    page,
    volume,
  }) => {
    test.slow();
    const name = 'volume-coloring-reset';
    await volume.openWith3DLayout(
      volume.writeFloatVolume(name, SIZE, radialRamp(SIZE)),
      name
    );
    await volume.openRenderingModule();
    const reset = page.locator(RESET);
    await expect(reset).toHaveAttribute(
      'aria-label',
      'Reset color and opacity'
    );

    await volume.waitForFittedColorRange(1000);

    // Reset must keep a preset chosen over the Grayscale default.
    await volume.showColorPresets();
    await page
      .locator('.thumbnail-container', { hasText: containsText('MR Default') })
      .first()
      .click();
    await expect(volume.selectedPreset()).toHaveText('MR Default');
    // The open preset grid pushes the opacity editor out of the capture area.
    await volume.showColorPresets(false);

    await volume.pressOn(ambientThumb(page), 'ArrowRight');
    await expect(ambientThumb(page)).toHaveAttribute('aria-valuenow', '0.3');

    const shift = await sliderValue(shiftThumb(volume));
    const width = await sliderValue(widthThumb(volume));
    // The editor draws both the opacity curve and the color bar for Shift and Width.
    await page.evaluate(
      (selector) => document.querySelector(selector)?.scrollIntoView(),
      EDITOR
    );
    const editor = await volume.stablePixels(EDITOR, 0);

    await dragOpacityCurve(page, 3);
    await waitForPixels(
      volume,
      editor,
      false,
      'Expected dragging to change the opacity curve'
    );
    await volume.pressOn(shiftThumb(volume), 'End');
    await volume.pressOn(widthThumb(volume), 'Home');
    await expect(shiftThumb(volume)).not.toHaveAttribute(
      'aria-valuenow',
      shift
    );
    await expect(widthThumb(volume)).not.toHaveAttribute(
      'aria-valuenow',
      width
    );

    await page.keyboard.press('Tab');
    await expect(reset).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(shiftThumb(volume)).toHaveAttribute('aria-valuenow', shift);
    await expect(widthThumb(volume)).toHaveAttribute('aria-valuenow', width);
    await waitForPixels(
      volume,
      editor,
      true,
      'Expected reset to restore the opacity curve and color bar'
    );
    await expect(ambientThumb(page)).toHaveAttribute('aria-valuenow', '0.3');
    await volume.showColorPresets();
    await expect(volume.selectedPreset()).toHaveText('MR Default');
  });
});
