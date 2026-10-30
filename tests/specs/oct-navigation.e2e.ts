import fs from 'node:fs';
import path from 'node:path';
import {
  dragContrast,
  enFaceAppearance,
  waitForEnFaceReady,
  expectControlsBesideSelector,
  expandEnFaceSection,
  expectEnFaceProjectionSettings,
  setSlabRange,
  setEnFaceWindow,
  getEnFaceWindow as getWindow,
  projectionTransform,
  expectProjectionTransform,
  CANVAS,
  PANEL,
  WINDOW_TOOL,
} from './octTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { waitForDownload, SESSION_SAVE_TIMEOUT } from './utils';
import {
  reference,
  SLICE_LINE,
  openControls,
  setThicknessThreshold,
  selectSetting,
  expectProjectionPixel,
  enableHighlight,
  dragEnFaceContrast,
  getOriginalWindow,
  expectHighlight,
  expectStackedMaskWithoutSidebar,
  openRetina,
  expectSliceLine,
  registerOctTestHooks,
} from './octInteractionTestUtils';

describe('Retinal OCT navigation', () => {
  registerOctTestHooks();
  it('restores a nondefault projection axis without resetting the saved slab', async () => {
    await openRetina();
    await expandEnFaceSection('projection');
    await selectSetting('enface-projection-axis', 'Sagittal');
    await setSlabRange(10, 100);
    await selectSetting('enface-projection-method', 'Maximum');
    await waitForEnFaceReady();
    expect(
      await $(
        '.v-overlay--active [data-testid="enface-projection-axis"] input'
      ).getValue()
    ).toBe('Sagittal');
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await $(CANVAS).waitForDisplayed();
    await waitForEnFaceReady();
    await openControls();
    await expectEnFaceProjectionSettings('Sagittal', 10, 100);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('preserves the projection camera across pane remounts and saved scenes, and resets on request', async () => {
    await openRetina(false, true);
    await setEnFaceWindow(1000, 500);
    await expectProjectionPixel(81);
    const initial = await projectionTransform();
    await $('button[data-testid^="control-button-Pan "]').click();
    await dragContrast(await $(CANVAS).getElement(), 55, 30);
    await browser.waitUntil(
      async () => (await projectionTransform())[4] !== initial[4]
    );
    const panned = await projectionTransform();
    await $('button[data-testid^="control-button-Zoom "]').click();
    await dragContrast(await $(CANVAS).getElement(), 0, -60);
    await browser.waitUntil(
      async () => (await projectionTransform())[0] !== panned[0]
    );
    const inspected = await projectionTransform();
    await expectProjectionPixel(81);

    const sourceCanvas = () => $('div[data-testid~="vtk-two-view"] canvas');
    await sourceCanvas().doubleClick();
    await expect($(CANVAS)).not.toExist();
    await sourceCanvas().waitForStable();
    await sourceCanvas().doubleClick();
    await waitForEnFaceReady();
    await expectProjectionTransform(inspected);
    await expectProjectionPixel(81);

    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await expectProjectionTransform(inspected);
    await expectProjectionPixel(81);

    await $('[data-testid="enface-reset-camera"]').click();
    await expectProjectionTransform(initial);
    await expectProjectionPixel(81);
    await $('button[data-testid^="control-button-Zoom "]').click();
    await dragContrast(await $(CANVAS).getElement(), 0, -60);
    await browser.waitUntil(
      async () => (await projectionTransform())[0] !== initial[0]
    );

    await $('button[data-testid="control-button-Reset Views"]').click();
    await expectProjectionTransform(initial);
    await setEnFaceWindow(1000, 500);
    const reset = await projectionTransform();
    await browser.setViewport({
      width: 1000,
      height: 600,
      devicePixelRatio: 1,
    });
    await browser.waitUntil(
      async () => (await projectionTransform())[0] !== reset[0]
    );
    await expectProjectionPixel(81);

    await $('button[data-testid^="control-button-Pan "]').click();
    await dragContrast(await $(CANVAS).getElement(), 55, 30);
    await openControls();
    await expandEnFaceSection('projection');
    await selectSetting('enface-projection-axis', 'Sagittal');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    const renderedCanvas = await $(CANVAS).getElement();
    const geometry = await renderedCanvas.execute(
      (canvas, width, height) => {
        const bounds = canvas.getBoundingClientRect();
        const transform = document
          .querySelector<SVGGElement>('[data-testid="enface-slice-lines"] g')!
          .getScreenCTM()!;
        const center = new DOMPoint(width / 2, height / 2).matrixTransform(
          transform
        );
        return {
          x: center.x - (bounds.left + bounds.width / 2),
          y: center.y - (bounds.top + bounds.height / 2),
        };
      },
      reference.size[1],
      reference.size[2]
    );
    expect(geometry.x).toBeCloseTo(0, 2);
    expect(geometry.y).toBeCloseTo(0, 2);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('uses standard pan, zoom and windowing while following source B-scan navigation', async () => {
    await browser.setViewport({
      width: 1440,
      height: 900,
      devicePixelRatio: 1,
    });
    await openRetina(true, true);
    const originalWindow = await getOriginalWindow();
    expect(originalWindow.width).toBeCloseTo(
      reference.range[1] - reference.range[0],
      2
    );
    expect(originalWindow.level).toBeCloseTo(
      (reference.range[1] + reference.range[0]) / 2,
      2
    );
    await browser.keys('Escape');
    await $(PANEL).waitForDisplayed({
      reverse: true,
    });
    await expectStackedMaskWithoutSidebar();
    const renderedCanvas = await $(CANVAS).getElement();
    const viewport = await renderedCanvas.execute((element) => {
      const canvas = element.getBoundingClientRect();
      const view = element
        .closest('[data-testid="enface-viewer"]')!
        .getBoundingClientRect();
      return {
        widthDifference: Math.abs(canvas.width - view.width),
        heightDifference: Math.abs(canvas.height - view.height),
      };
    });
    expect(viewport.widthDifference).toBeLessThan(2);
    expect(viewport.heightDifference).toBeLessThan(2);
    await volViewPage.focusFirst2DView();
    await expectSliceLine();
    const horizontalDirection = await $(SLICE_LINE).execute((element) => {
      if (!(element instanceof SVGLineElement))
        throw new Error('Expected an SVG slice indicator');
      const line = element;
      const transform = line.getScreenCTM()!;
      const start = new DOMPoint(
        line.x1.baseVal.value,
        line.y1.baseVal.value
      ).matrixTransform(transform);
      const end = new DOMPoint(
        line.x2.baseVal.value,
        line.y2.baseVal.value
      ).matrixTransform(transform);
      return end.x - start.x;
    });
    expect(horizontalDirection).toBeGreaterThan(0);
    const beforeKey = await volViewPage.getFirst2DSlice();
    if (beforeKey === null)
      throw new Error('The original OCT view has no slice position');
    await volViewPage.advanceSliceAndWait();
    expect(await volViewPage.getFirst2DSlice()).toBeLessThan(beforeKey);
    await expectSliceLine();

    const sourceView = (await volViewPage.getViews2D())[0];
    await sourceView.$('canvas').waitForStable();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const source = document.querySelector(
            'div[data-testid~="vtk-two-view"]'
          );
          const canvas = source?.querySelector('canvas');
          if (!canvas || !source) return false;
          const rect = canvas.getBoundingClientRect();
          const underPointer = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          );
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            underPointer === canvas &&
            document.querySelectorAll('.v-menu.v-overlay--active').length === 0
          );
        }),
      {
        timeoutMsg:
          'Expected a stable, unobscured source OCT canvas before native wheel input',
      }
    );
    const sourceBounds = (await sourceView.execute((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })) as { x: number; y: number; width: number; height: number };
    const sourceLocation = { x: sourceBounds.x, y: sourceBounds.y };
    const sourceSize = {
      width: sourceBounds.width,
      height: sourceBounds.height,
    };
    const beforeWheel = await volViewPage.getFirst2DSlice();
    const sourceHandle = $('.vtk-container-wrapper .slice-slider-handle');
    const beforeWheelHandleY = await sourceHandle.getLocation('y');
    const beforeWheelLineY = await $(SLICE_LINE).getLocation('y');
    await browser
      .action('pointer')
      .move({
        x: Math.round(sourceLocation.x + sourceSize.width / 2),
        y: Math.round(sourceLocation.y + sourceSize.height / 2),
      })
      .perform();
    await browser.performActions([
      {
        type: 'wheel',
        id: 'oct-source-wheel',
        actions: [
          {
            type: 'scroll',
            x: Math.round(sourceLocation.x + sourceSize.width / 2),
            y: Math.round(sourceLocation.y + sourceSize.height / 2),
            deltaX: 0,
            deltaY: 120,
            origin: 'viewport',
          },
        ],
      },
    ]);
    try {
      await browser.waitUntil(
        async () => (await volViewPage.getFirst2DSlice()) !== beforeWheel
      );
    } finally {
      await browser.releaseActions();
    }
    await expectSliceLine();
    expect(await sourceHandle.getLocation('y')).toBeGreaterThan(
      beforeWheelHandleY
    );
    expect(await $(SLICE_LINE).getLocation('y')).toBeGreaterThan(
      beforeWheelLineY
    );

    const slider = $('.vtk-container-wrapper .slice-slider');
    const sliderLocation = await slider.getLocation();
    const sliderSize = await slider.getSize();
    const beforeSlider = await volViewPage.getFirst2DSlice();
    const handleLocation = await sourceHandle.getLocation();
    const handleSize = await sourceHandle.getSize();
    const beforeSliderLineY = await $(SLICE_LINE).getLocation('y');
    const handleX = Math.round(handleLocation.x + handleSize.width / 2);
    const handleY = Math.round(handleLocation.y + handleSize.height / 2);
    await browser
      .action('pointer')
      .move({ x: handleX, y: handleY })
      .down()
      .move({ x: handleX, y: handleY + Math.round(sliderSize.height * 0.15) })
      .up()
      .perform();
    await browser.waitUntil(
      async () => (await volViewPage.getFirst2DSlice()) !== beforeSlider
    );
    await expectSliceLine();
    expect(await sourceHandle.getLocation('y')).toBeGreaterThan(
      handleLocation.y
    );
    expect(await $(SLICE_LINE).getLocation('y')).toBeGreaterThan(
      beforeSliderLineY
    );

    const projectionGeometry = $('[data-testid="enface-slice-lines"] > g');
    const beforePan = await projectionGeometry.getAttribute('transform');
    await $('button[data-testid^="control-button-Pan "]').click();
    await dragContrast(await $(CANVAS).getElement(), 55, 30);
    await browser.waitUntil(
      async () =>
        (await projectionGeometry.getAttribute('transform')) !== beforePan
    );
    const beforeZoom = await $(SLICE_LINE).getSize();
    await $('button[data-testid^="control-button-Zoom "]').click();
    await dragContrast(await $(CANVAS).getElement(), 0, -60);
    await browser.waitUntil(
      async () => (await $(SLICE_LINE).getSize()).width !== beforeZoom.width
    );

    // Pointer input through the toolbar changes rendered pixels.
    const beforePixels = (await enFaceAppearance()).image;
    await dragEnFaceContrast();
    expect(await $(WINDOW_TOOL).getAttribute('class')).toContain(
      'tool-btn-selected'
    );
    expect((await enFaceAppearance()).image).not.toBe(beforePixels);
    expect(await getOriginalWindow()).toEqual(originalWindow);
    expect(await $('[data-testid="enface-window-width"]').isExisting()).toBe(
      false
    );
    expect(await $('[data-testid="enface-window-level"]').isExisting()).toBe(
      false
    );
    // Return to the central retinal B-scan for the comparison screenshot.
    await browser
      .action('pointer')
      .move({
        x: Math.round(sliderLocation.x + sliderSize.width / 2),
        y: Math.round(sliderLocation.y + sliderSize.height / 2),
      })
      .down()
      .up()
      .perform();
    await expectSliceLine();
    // Select before capturing the comparison with a textured overlay.
    await $('button[data-testid^="control-button-Select "]').click();
    await openControls();
    await enableHighlight();
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await browser.waitUntil(
      async () => (await enFaceAppearance()).coloredPixels > 100
    );
    await expectSliceLine();
    await expectControlsBesideSelector();
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await $('.Vue-Toastification__toast').waitForDisplayed({ reverse: true });
      await browser.saveScreenshot(
        path.join(captureDirectory, 'retina-en-face-thickness.png')
      );
    }
    await browser.keys('Escape');
    const savedWindow = await getWindow();
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    if (captureDirectory)
      fs.copyFileSync(
        path.join(TEMP_DIR, saved),
        path.join(captureDirectory, 'oct-saved-session.volview.zip')
      );
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await volViewPage.waitForViews();
    await $(CANVAS).waitForDisplayed();
    await expectHighlight(true);
    await openControls();
    await expandEnFaceSection('thickness');
    expect(
      await $(
        '.v-overlay--active [data-testid="enface-segmentation-segment"]'
      ).getText()
    ).toContain('Synthetic retinal layer');
    await browser.keys('Escape');
    await expectSliceLine();
    expect(await getWindow()).toEqual(savedWindow);
    expect(await getOriginalWindow()).toEqual(originalWindow);
    await expectStackedMaskWithoutSidebar();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
