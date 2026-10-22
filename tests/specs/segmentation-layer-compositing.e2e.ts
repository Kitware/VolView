import { volViewPage } from '../pageobjects/volview.page';
import { openAnnotationSegments, segmentRow } from './segmentationTestUtils';
import {
  capture2DViewPixels,
  selectLayout,
  waitForModuleTransitions,
} from './utils';
import { openOverlaySegmentationFixture } from './overlaySegmentationTestUtils';

const colors = async () => {
  const [{ data }] = await capture2DViewPixels(
    80,
    'segmentation-layer-compositing.png'
  );
  const counts = { blue: 0, halfBlue: 0, pastelBlue: 0, black: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const [red, green, blue] = data.slice(i, i + 3);
    if (red <= 2 && green <= 2 && blue >= 250) counts.blue++;
    if (red <= 2 && green <= 2 && blue >= 125 && blue <= 130) counts.halfBlue++;
    if (red >= 125 && red <= 130 && green >= 125 && green <= 130 && blue >= 250)
      counts.pastelBlue++;
    if (red <= 2 && green <= 2 && blue <= 2) counts.black++;
  }
  return counts;
};

const waitForColors = async (
  matches: (counts: Awaited<ReturnType<typeof colors>>) => boolean,
  timeoutMsg: string
) => {
  await $('header').moveTo();
  await waitForModuleTransitions();
  await $('[data-testid~="vtk-two-view"]').waitForStable();
  await browser.waitUntil(async () => matches(await colors()), { timeoutMsg });
};

const setFill = async (value: 0 | 0.5 | 1) => {
  await openAnnotationSegments();
  const display = $('[data-testid="segment-display-section"]');
  if ((await display.getAttribute('aria-expanded')) !== 'true')
    await display.click();
  await waitForModuleTransitions();
  const slider = $(
    '.display-controls .v-slider:has(input[name="Fill Opacity"]) [role="slider"]'
  );
  await slider.scrollIntoView({ block: 'center', behavior: 'instant' });
  await slider.execute((element) => element.focus());
  await browser.keys(
    value === 1
      ? ['End']
      : ['Home', ...Array.from({ length: value * 100 }, () => 'ArrowRight')]
  );
  await expect(slider).toHaveAttribute('aria-valuenow', String(value));
};

describe('Segmentation above image overlays', () => {
  it('composites fill and outlines over the image layer through display changes', async () => {
    await openOverlaySegmentationFixture('compositing');
    const opacity = $('[data-testid="layer-opacity-slider"] [role="slider"]');
    await opacity.scrollIntoView({ block: 'center', behavior: 'instant' });
    await opacity.execute((element) => element.focus());
    await browser.keys('End');
    await expect(opacity).toHaveAttribute('aria-valuenow', '1');

    await setFill(1);
    await waitForColors(
      ({ blue, black }) => blue > 2000 && black > 2000,
      'Expected opaque blue segment fill above the full-opacity black image layer'
    );
    const opaque = await colors();

    await setFill(0.5);
    await waitForColors(
      ({ blue, halfBlue }) => blue > 100 && halfBlue > 2000,
      'Expected 50% blue fill over black while the outline stays fully blue'
    );
    await volViewPage.renderingModuleTab.click();
    const visibility = $('[data-testid="layer-visibility"]');
    await visibility.scrollIntoView({ block: 'center', behavior: 'instant' });
    await visibility.click();
    await expect(visibility).toHaveText(expect.stringContaining('SHOW'));
    await waitForColors(
      ({ blue, pastelBlue }) => blue > 100 && pastelBlue > 2000,
      'Expected transparent blue fill to blend with the white base when the image layer is hidden'
    );
    await visibility.click();
    await expect(visibility).toHaveText(expect.stringContaining('HIDE'));
    await waitForColors(
      ({ blue, halfBlue }) => blue > 100 && halfBlue > 2000,
      'Expected showing the image layer to restore the blue-over-black blend'
    );

    await setFill(0);
    const outlined = ({
      blue,
      halfBlue,
      black,
    }: Awaited<ReturnType<typeof colors>>) =>
      blue > 100 &&
      blue < opaque.blue / 4 &&
      halfBlue === 0 &&
      black > opaque.black + opaque.blue / 2;
    await waitForColors(
      outlined,
      'Expected a fully blue outline and transparent interior above the image layer'
    );
    const row = await segmentRow('Blue mask');
    await row.$('button:has(i.mdi-eye)').click();
    await waitForColors(
      ({ blue, halfBlue, black }) =>
        blue === 0 && halfBlue === 0 && black > opaque.black + opaque.blue / 2,
      'Expected hiding the segment to remove its outline'
    );
    await row.$('button:has(i.mdi-eye-off)').click();
    await waitForColors(
      outlined,
      'Expected showing the segment to restore its outline'
    );

    await selectLayout('3D Only', 0, true);
    await selectLayout('Axial Only', 1, false);
    await waitForColors(
      outlined,
      'Expected the remounted slice to retain the blue outline'
    );
    await setFill(1);
    await waitForColors(
      ({ blue, black }) => blue > 2000 && black > 2000,
      'Expected the remounted slice to retain opaque fill above the image layer'
    );
  });
});
