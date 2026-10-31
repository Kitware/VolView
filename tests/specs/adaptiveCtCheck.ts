import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  appearance,
  colorShift,
  openVolumeRenderingControls,
  pixelDifference,
} from './volumeRenderingTestUtils';
import { waitForModuleTransitions } from './utils';
const resetSelector = '[data-testid="volume-reset-color-opacity"]';
export async function checkAdaptiveCtReset(
  load: () => Promise<void>,
  selectPreset: (name: string) => Promise<void>
) {
  await load();
  await selectPreset('CT-AAA');
  const thumbnail = $('[data-testid="volume-preset-CT-AAA"] img');
  await thumbnail.waitForExist();
  const captured = (await thumbnail.execute(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let foreground = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        [0, 1, 2].some(
          (channel) => Math.abs(pixels[offset + channel] - pixels[channel]) > 20
        )
      )
        foreground++;
    }
    return { width: canvas.width, height: canvas.height, foreground };
  })) as { width: number; height: number; foreground: number };
  expect([captured.width, captured.height]).toEqual([80, 80]);
  expect(captured.foreground).toBeGreaterThan(0);

  const cinematic = $('.v-expansion-panel-title*=Cinematic Rendering');
  await cinematic.scrollIntoView({ block: 'center', behavior: 'instant' });
  if ((await cinematic.getAttribute('aria-expanded')) !== 'true')
    await cinematic.click();
  await waitForModuleTransitions();
  const ambient = $(
    "//label[normalize-space(.)='Ambient']/ancestor::div[contains(@class, 'v-slider')][1]//*[@role='slider']"
  );
  await ambient.scrollIntoView({ block: 'center', behavior: 'instant' });
  await ambient.execute((element) => element.focus());
  await browser.keys('End');
  await expect(ambient).toHaveAttribute('aria-valuenow', '1');
  await expect($(resetSelector)).toBeDisabled();
  await selectPreset('Adaptive-Balanced');
  await expect(ambient).toHaveAttribute('aria-valuenow', '1');
  await selectPreset('CT-AAA');
  await expect(ambient).toHaveAttribute('aria-valuenow', '1');
  await ambient.execute((element) => element.blur());
  await $('header').moveTo();
  await browser.waitUntil(async () => (await appearance()).visible > 250);
  const original = await appearance();
  const shift = await colorShift();
  const initialShift = (await shift.getAttribute('aria-valuenow'))!;
  expect(initialShift).toBe('0');
  await shift.execute((element) => element.focus());
  await browser.keys('ArrowRight');
  await expect($(resetSelector)).toBeEnabled();
  await browser.keys('ArrowLeft');
  await expect(shift).toHaveAttribute('aria-valuenow', initialShift);
  await expect($(resetSelector)).toBeDisabled();
  await shift.execute((element) => element.blur());
  const opacity = $('[data-testid="volume-opacity-editor"] canvas');
  await opacity.scrollIntoView({ block: 'center', behavior: 'instant' });
  await opacity.waitForStable();
  const bounds = (await opacity.execute((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  })) as Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
  const x = Math.round(bounds.x + bounds.width * 0.5);
  const y = Math.round(bounds.y + bounds.height * 0.5);
  await browser
    .action('pointer')
    .move({ x, y })
    .down()
    .move({ x: x + Math.round(bounds.width * 0.2), y, duration: 100 })
    .up()
    .perform();
  await browser.waitUntil(
    async () => pixelDifference(await appearance(), original) > 2,
    {
      timeoutMsg: 'Expected a CT opacity shift to change the rendered volume',
    }
  );
  await expect($(resetSelector)).toBeEnabled();
  const opacityEdited = await appearance();
  await shift.scrollIntoView({ block: 'center', behavior: 'instant' });
  await shift.execute((element) => element.focus());
  await browser.keys('End');
  const changedShift = (await shift.getAttribute('aria-valuenow'))!;
  expect(changedShift).not.toBe(initialShift);
  await expect($(resetSelector)).toBeEnabled();
  await browser.waitUntil(
    async () => pixelDifference(await appearance(), opacityEdited) > 2
  );
  const edited = await appearance();
  await $('[data-testid="module-tab-Data"]').click();
  await waitForModuleTransitions();
  await openVolumeRenderingControls();
  await expect(await colorShift()).toHaveAttribute(
    'aria-valuenow',
    changedShift
  );
  await browser.waitUntil(
    async () => pixelDifference(await appearance(), edited, 4) < 3,
    {
      timeoutMsg:
        'Expected both manual CT edits to survive reopening Rendering',
    }
  );
  const presets = $('.v-expansion-panel-title*=Color Presets');
  await presets.scrollIntoView({ block: 'center', behavior: 'instant' });
  await presets.click();
  await expect(presets).toHaveAttribute('aria-expanded', 'false');
  await waitForModuleTransitions();
  const reset = $(resetSelector);
  await reset.scrollIntoView({ block: 'center', behavior: 'instant' });
  await expect(reset).toBeDisplayed();
  await expect(reset).toHaveAttribute('aria-label', 'Reset color and opacity');
  await expect($('.mapping-range-editor').$(resetSelector)).toBeDisplayed();
  await expect(reset).toBeEnabled();
  await browser.saveScreenshot(
    path.join(TEMP_DIR, 'volume-reset-placement.png')
  );
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect(await colorShift()).toHaveAttribute(
    'aria-valuenow',
    initialShift
  );
  await cinematic.scrollIntoView({ block: 'center', behavior: 'instant' });
  if ((await cinematic.getAttribute('aria-expanded')) !== 'true')
    await cinematic.click();
  await waitForModuleTransitions();
  await expect(
    $(
      "//label[normalize-space(.)='Ambient']/ancestor::div[contains(@class, 'v-slider')][1]//*[@role='slider']"
    )
  ).toHaveAttribute('aria-valuenow', '1');
  await browser.waitUntil(
    async () => pixelDifference(await appearance(), original, 4) < 3,
    {
      timeoutMsg:
        'Expected reset to restore CT color and opacity with the edited lighting',
    }
  );
  await presets.scrollIntoView({ block: 'center', behavior: 'instant' });
  await presets.click();
  await expect($('[data-testid="volume-preset-CT-AAA"]')).toHaveElementClass(
    'bg-blue'
  );
}
