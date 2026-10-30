import path from 'node:path';
import { Key } from 'webdriverio';
import {
  PANEL,
  attachMaskThroughDataPanel,
  enFaceAppearance,
  enFacePixel,
  waitForEnFaceReady,
  stageGenericOCT,
  expandEnFaceSection,
  setSlabRange,
  setEnFaceWindow,
  slabThumb,
  selectEnFace,
} from './octTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  openThroughDialog,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
  waitForModuleTransitions,
} from './utils';
import {
  openAnnotationSegments,
  setSegmentationDisplaySlider as setDisplaySlider,
  selectSegment,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  THRESHOLD,
  STEM,
  stageFixture,
  openControls,
  setThicknessThreshold,
  selectSetting,
  expectProjectionPixel,
  enableHighlight,
  expectHighlight,
  openHighlightedSegmentationDisplay,
  openRetina,
  registerOctTestHooks,
} from './octInteractionTestUtils';

describe('Retinal OCT occupied-depth', () => {
  registerOctTestHooks();
  it('highlights physical thickness and restores its selected segment, threshold and slab', async () => {
    await openRetina(true);
    await enableHighlight();
    await setThicknessThreshold(31);
    await expectHighlight(true);
    const expectThinColumns = async () => {
      await browser.waitUntil(
        async () => {
          const thin = await enFacePixel(20, 12);
          const thick = await enFacePixel(60, 12);
          const absent = await enFacePixel(100, 12);
          return (
            thin[0] > thin[1] + 20 &&
            thick[0] === thick[1] &&
            absent[0] === absent[1]
          );
        },
        {
          timeoutMsg:
            'Only positive thickness below the threshold should be highlighted',
        }
      );
    };
    await expectThinColumns();
    const slider = $(
      '.v-overlay--active [data-testid="enface-thickness-threshold"] [role="slider"]'
    );
    await $(THRESHOLD).click();
    await browser.keys('Tab');
    await expect(slider).toBeFocused();
    await browser.keys('ArrowRight');
    await expect($(THRESHOLD)).toHaveValue('31.1');
    await browser.keys('Home');
    await expect($(THRESHOLD)).toHaveValue('0');
    await expectHighlight(false);
    const maximum = await slider.getAttribute('aria-valuemax');
    await browser.keys('End');
    await expect($(THRESHOLD)).toHaveValue(maximum!);
    await expectHighlight(true);
    await setThicknessThreshold(20.8);
    await expectHighlight(false);
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await expectThinColumns();
    await expandEnFaceSection('projection');
    await setSlabRange(0, 10);
    await expectHighlight(false);
    await expect(slider).toHaveAttribute('aria-valuemax', '0.1');
    await expect($(THRESHOLD)).toHaveValue('31');
    await setSlabRange(100, 114);
    await expectHighlight(true);
    await expectThinColumns();
    await selectSetting(
      'enface-segmentation-segment',
      'Alternative synthetic band'
    );
    await expectHighlight(false);
    await setThicknessThreshold(60);
    await expectHighlight(true);
    await selectSetting('enface-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await expectHighlight(true);
    await openControls();
    await expandEnFaceSection('projection');
    await expect(
      $('.v-overlay--active [data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '100');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '114');
    await expandEnFaceSection('thickness');
    await expect($(THRESHOLD)).toHaveValue('60');
    await expect(
      $('.v-overlay--active [data-testid="enface-segmentation-segment"]')
    ).toHaveText(expect.stringContaining('Alternative synthetic band'));
    await expect(
      $('.v-overlay--active [data-testid="enface-thin-highlight"] input')
    ).toBeSelected();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('uses imported NIfTI geometry for thickness when units are unspecified', async () => {
    const directory = makeTempDir(STEM);
    const name = stageGenericOCT(directory, 'nii', false);
    await volViewPage.open();
    await openThroughDialog(path.join(directory, name));
    await volViewPage.waitForViews();
    await selectEnFace();
    await openControls();
    await expandEnFaceSection('projection');
    await selectSetting('enface-projection-axis', 'Coronal');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    await attachMaskThroughDataPanel(stageFixture('synthetic-thickness.nrrd'));
    await openAnnotationSegments();
    await waitForSegmentContent('Synthetic retinal band');
    await selectSegment('Synthetic retinal band');
    await openControls();
    await expandEnFaceSection('thickness');
    await expect(
      $('.v-overlay--active [data-testid="enface-thin-highlight"] input')
    ).toBeEnabled();
    await enableHighlight();
    await setThicknessThreshold(1);
    await expectHighlight(false);
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await browser.keys(Key.Escape);
    await $(PANEL).waitForDisplayed({ reverse: true });
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    const toggle = $('[data-testid="enface-rendering-toggle"]');
    await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
    await toggle.waitForClickable();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true')
      await toggle.click();
    const sidebar = $('[data-testid="enface-sidebar-controls"]');
    await sidebar.waitForDisplayed();
    await toggle.$('..').waitForStable();
    for (const selector of [
      '[data-testid="enface-thin-highlight"] input',
      '[data-testid="enface-segmentation-segment"] input',
      '[data-testid="enface-thickness-threshold-input"] input',
    ])
      await expect(sidebar.$(selector)).toBeEnabled();
    await expect(
      sidebar.$('[data-testid="enface-thickness-threshold-input"] input')
    ).toHaveValue('31');
    await expectHighlight(true);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders below-threshold labels with normal fill, outline and visibility controls', async () => {
    await openRetina(true);
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(81);
    const interior = () => enFacePixel(20, 12);
    const boundary = () => enFacePixel(42.5, 12, { x: -2, y: 0 });
    const innerBoundary = () => enFacePixel(42.5, 12, { x: -12, y: 0 });
    const scanEdge = () => enFacePixel(-0.5, 12, { x: 2, y: 0 });
    const outside = () => enFacePixel(60, 12);
    const baseline = {
      interior: await interior(),
      boundary: await boundary(),
      innerBoundary: await innerBoundary(),
      scanEdge: await scanEdge(),
      outside: await outside(),
    };
    const expectPixel = async (
      sample: () => Promise<number[]>,
      expected: number[]
    ) =>
      browser.waitUntil(
        async () =>
          (await sample()).every(
            (channel, index) => Math.abs(channel - expected[index]) <= 2
          ),
        { timeoutMsg: `Expected rendered label pixel ${expected.join(',')}` }
      );
    const red = (background: number[], alpha: number) =>
      background.map((channel, index) =>
        index === 3
          ? 255
          : Math.round(channel * (1 - alpha) + (index === 0 ? 255 : 0) * alpha)
      );
    await openHighlightedSegmentationDisplay();

    await setDisplaySlider('Outline Thickness', 10);
    await setDisplaySlider('Fill Opacity', 0);
    await expectPixel(boundary, [255, 0, 0, 255]);
    await expectPixel(interior, baseline.interior);
    await expectPixel(innerBoundary, baseline.innerBoundary);
    await expectPixel(outside, baseline.outside);
    // Standard label outlines stay inside the label and do not invent scan-edge background.
    await expectPixel(scanEdge, baseline.scanEdge);
    expect((await enFaceAppearance()).coloredPixels).toBeGreaterThan(100);

    await setDisplaySlider('Fill Opacity', 0.5);
    await setDisplaySlider('Outline Opacity', 0.5);
    await expectPixel(interior, red(baseline.interior, 0.5));
    await expectPixel(boundary, red(baseline.boundary, 0.5));
    await expectPixel(outside, baseline.outside);

    await setDisplaySlider('Outline Opacity', 0);
    await expectPixel(boundary, baseline.boundary);
    await expectPixel(interior, red(baseline.interior, 0.5));
    await setDisplaySlider('Outline Thickness', 0);
    await expectPixel(boundary, red(baseline.boundary, 0.5));
    await setDisplaySlider('Fill Opacity', 0);
    await expectHighlight(false);
    await setDisplaySlider('Outline Opacity', 1);
    await setDisplaySlider('Outline Thickness', 10);
    await expectPixel(boundary, [255, 0, 0, 255]);
    await expectPixel(interior, baseline.interior);

    await $('[data-testid="toggle-segments-visible-button"]').click();
    await expectHighlight(false);
    await setDisplaySlider('Fill Opacity', 1);
    await expectHighlight(false);
    await $('[data-testid="toggle-segments-visible-button"]').click();
    await expectPixel(interior, [255, 0, 0, 255]);
    await expectPixel(boundary, [255, 0, 0, 255]);
  });
});
