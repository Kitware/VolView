import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  appearance,
  colorShift,
  openVolumeRenderingControls,
  pixelDifference,
} from './volumeRenderingTestUtils';
import { waitForModuleTransitions } from './utils';
import { step, viewport } from './adaptivePresetTrace';
const resetSelector = '[data-testid="volume-reset-color-opacity"]';
export async function checkAdaptiveCtReset(
  load: () => Promise<void>,
  selectPreset: (name: string) => Promise<void>
) {
  await viewport('ct');

  await step('ct01', async () => load());
  await step('ct02', async () => selectPreset('CT-AAA'));
  const thumbnail = $('[data-testid="volume-preset-CT-AAA"] img');
  await thumbnail.waitForExist();
  const captured = (await step('ct/presetThumbnail', () =>
    thumbnail.execute(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      ).data;
      let foreground = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          [0, 1, 2].some(
            (channel) =>
              Math.abs(pixels[offset + channel] - pixels[channel]) > 20
          )
        )
          foreground++;
      }
      return { width: canvas.width, height: canvas.height, foreground };
    })
  )) as { width: number; height: number; foreground: number };
  expect([captured.width, captured.height]).toEqual([80, 80]);
  expect(captured.foreground).toBeGreaterThan(0);

  const cinematic = $('.v-expansion-panel-title*=Cinematic Rendering');
  await step('ct03', async () =>
    cinematic.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  if (
    (await step('ct04', async () =>
      cinematic.getAttribute('aria-expanded')
    )) !== 'true'
  )
    await step('ct05', async () => cinematic.click());
  await step('ct06', async () => waitForModuleTransitions());
  const ambient = $(
    "//label[normalize-space(.)='Ambient']/ancestor::div[contains(@class, 'v-slider')][1]//*[@role='slider']"
  );
  await step('ct07', async () =>
    ambient.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await step('ct08', async () => ambient.execute((element) => element.focus()));
  await step('ct09', async () => browser.keys('End'));
  await step('ct10', async () =>
    expect(ambient).toHaveAttribute('aria-valuenow', '1')
  );
  await step('ct11', async () => expect($(resetSelector)).toBeDisabled());
  await step('ct12', async () => selectPreset('Adaptive-Balanced'));
  await step('ct13', async () =>
    expect(ambient).toHaveAttribute('aria-valuenow', '1')
  );
  await step('ct14', async () => selectPreset('CT-AAA'));
  await step('ct15', async () =>
    expect(ambient).toHaveAttribute('aria-valuenow', '1')
  );
  await step('ct16', async () => ambient.execute((element) => element.blur()));
  await step('ct17', async () => $('header').moveTo());
  await step('ct18', async () =>
    browser.waitUntil(
      async () => (await step('ct19', async () => appearance())).visible > 250
    )
  );
  const original = await step('ct20', async () => appearance());
  const shift = await step('ct21', async () => colorShift());
  const initialShift = (await step('ct22', async () =>
    shift.getAttribute('aria-valuenow')
  ))!;
  expect(initialShift).toBe('0');
  await step('ct23', async () => shift.execute((element) => element.focus()));
  await step('ct24', async () => browser.keys('ArrowRight'));
  await step('ct25', async () => expect($(resetSelector)).toBeEnabled());
  await step('ct26', async () => browser.keys('ArrowLeft'));
  await step('ct27', async () =>
    expect(shift).toHaveAttribute('aria-valuenow', initialShift)
  );
  await step('ct28', async () => expect($(resetSelector)).toBeDisabled());
  await step('ct29', async () => shift.execute((element) => element.blur()));
  const opacity = $('[data-testid="volume-opacity-editor"] canvas');
  await step('ct30', async () =>
    opacity.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await step('ct31', async () => opacity.waitForStable());
  const bounds = (await step('ct32', async () =>
    opacity.execute((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    })
  )) as Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
  const x = Math.round(bounds.x + bounds.width * 0.5);
  const y = Math.round(bounds.y + bounds.height * 0.5);
  await step('ct33', async () =>
    browser
      .action('pointer')
      .move({ x, y })
      .down()
      .move({ x: x + Math.round(bounds.width * 0.2), y, duration: 100 })
      .up()
      .perform()
  );
  await step('ct34', async () =>
    browser.waitUntil(
      async () =>
        pixelDifference(
          await step('ct35', async () => appearance()),
          original
        ) > 2,
      {
        timeoutMsg: 'Expected a CT opacity shift to change the rendered volume',
      }
    )
  );
  await step('ct36', async () => expect($(resetSelector)).toBeEnabled());
  const opacityEdited = await step('ct37', async () => appearance());
  await step('ct38', async () =>
    shift.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await step('ct39', async () => shift.execute((element) => element.focus()));
  await step('ct40', async () => browser.keys('End'));
  const changedShift = (await step('ct41', async () =>
    shift.getAttribute('aria-valuenow')
  ))!;
  expect(changedShift).not.toBe(initialShift);
  await step('ct42', async () => expect($(resetSelector)).toBeEnabled());
  await step('ct43', async () =>
    browser.waitUntil(
      async () =>
        pixelDifference(
          await step('ct44', async () => appearance()),
          opacityEdited
        ) > 2
    )
  );
  const edited = await step('ct45', async () => appearance());
  await step('ct46', async () => $('[data-testid="module-tab-Data"]').click());
  await step('ct47', async () => waitForModuleTransitions());
  await step('ct48', async () => openVolumeRenderingControls('ct'));
  await step('ct49', async () =>
    expect(await step('ct50', async () => colorShift())).toHaveAttribute(
      'aria-valuenow',
      changedShift
    )
  );
  await step('ct51', async () =>
    browser.waitUntil(
      async () =>
        pixelDifference(
          await step('ct52', async () => appearance()),
          edited,
          4
        ) < 3,
      {
        timeoutMsg:
          'Expected both manual CT edits to survive reopening Rendering',
      }
    )
  );
  const presets = $('.v-expansion-panel-title*=Color Presets');
  await step('ct53', async () =>
    presets.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await step('ct54', async () => presets.click());
  await step('ct55', async () =>
    expect(presets).toHaveAttribute('aria-expanded', 'false')
  );
  await step('ct56', async () => waitForModuleTransitions());
  const reset = $(resetSelector);
  await step('ct57', async () =>
    reset.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await step('ct58', async () => expect(reset).toBeDisplayed());
  await step('ct59', async () =>
    expect(reset).toHaveAttribute('aria-label', 'Reset color and opacity')
  );
  await step('ct60', async () =>
    expect($('.mapping-range-editor').$(resetSelector)).toBeDisplayed()
  );
  await step('ct61', async () => expect(reset).toBeEnabled());
  await step('ct62', async () =>
    browser.saveScreenshot(path.join(TEMP_DIR, 'volume-reset-placement.png'))
  );
  await step('ct63', async () => reset.click());
  await step('ct64', async () => expect(reset).toBeDisabled());
  await step('ct65', async () =>
    expect(await step('ct66', async () => colorShift())).toHaveAttribute(
      'aria-valuenow',
      initialShift
    )
  );
  await step('ct67', async () =>
    cinematic.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  if (
    (await step('ct68', async () =>
      cinematic.getAttribute('aria-expanded')
    )) !== 'true'
  )
    await step('ct69', async () => cinematic.click());
  await step('ct70', async () => waitForModuleTransitions());
  await step('ct71', async () =>
    expect(
      $(
        "//label[normalize-space(.)='Ambient']/ancestor::div[contains(@class, 'v-slider')][1]//*[@role='slider']"
      )
    ).toHaveAttribute('aria-valuenow', '1')
  );
  await step('ct72', async () =>
    browser.waitUntil(
      async () =>
        pixelDifference(
          await step('ct73', async () => appearance()),
          original,
          4
        ) < 3,
      {
        timeoutMsg:
          'Expected reset to restore CT color and opacity with the edited lighting',
      }
    )
  );
  await step('ct74', async () =>
    presets.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await step('ct75', async () => presets.click());
  await step('ct76', async () =>
    expect($('[data-testid="volume-preset-CT-AAA"]')).toHaveElementClass(
      'bg-blue'
    )
  );
}
