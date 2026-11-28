import fs from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, registerOctTestHooks } from '../fixtures';
import { waitForTransitions } from '../pageobjects/volview.page';
import { CANVAS, MENU_PANEL, WINDOW_TOOL } from './octTestUtils';
import { reference, SLICE_LINE } from './octInteractionTestUtils';

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The element is not on screen');
  return box;
};

test.describe('Retinal OCT navigation', () => {
  registerOctTestHooks();
  test('restores a nondefault projection axis without resetting the saved slab', async ({
    page,
    volview,
    oct,
    octInteraction,
  }) => {
    await octInteraction.openRetina();
    await oct.expandEnFaceSection();
    await oct.selectSetting('enface-projection-axis', 'Sagittal');
    await oct.setSlabRange(10, 100);
    await oct.selectSetting('enface-projection-method', 'Maximum');
    await oct.waitForEnFaceReady();
    expect(
      await page
        .locator(
          '.v-overlay--active [data-testid="enface-projection-axis"] input'
        )
        .inputValue()
    ).toBe('Sagittal');
    await page.keyboard.press('Escape');
    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    await expect(page.locator(CANVAS).first()).toBeVisible();
    await oct.waitForEnFaceReady();
    await oct.openEnFaceControls();
    await oct.expectEnFaceProjectionSettings('Sagittal', 10, 100);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('preserves the projection camera across pane remounts and saved scenes, and resets on request', async ({
    page,
    volview,
    oct,
    octInteraction,
  }) => {
    const canvas = page.locator(CANVAS).first();
    await octInteraction.openRetina(false, true);
    await oct.setEnFaceWindow(1000, 500);
    await octInteraction.expectProjectionPixel(81);
    const initial = await oct.projectionTransform();
    await oct.toolButton('Pan').click();
    await oct.dragContrast(canvas, 55, 30);
    await expect
      .poll(async () => (await oct.projectionTransform())[4])
      .not.toBe(initial[4]);
    const panned = await oct.projectionTransform();
    await oct.toolButton('Zoom').click();
    await oct.dragContrast(canvas, 0, -60);
    await expect
      .poll(async () => (await oct.projectionTransform())[0])
      .not.toBe(panned[0]);
    const inspected = await oct.projectionTransform();
    await octInteraction.expectProjectionPixel(81);

    const sourceCanvas = page
      .locator('div[data-testid~="vtk-two-view"] canvas')
      .first();
    await sourceCanvas.dblclick();
    await expect(page.locator(CANVAS)).not.toBeAttached();
    await waitForTransitions(sourceCanvas);
    await sourceCanvas.dblclick();
    await oct.waitForEnFaceReady();
    await oct.expectProjectionTransform(inspected);
    await octInteraction.expectProjectionPixel(81);

    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    await oct.waitForEnFaceReady();
    await oct.expectProjectionTransform(inspected);
    await octInteraction.expectProjectionPixel(81);

    await page.locator('[data-testid="enface-reset-camera"]').click();
    await oct.expectProjectionTransform(initial);
    await octInteraction.expectProjectionPixel(81);
    await oct.toolButton('Zoom').click();
    await oct.dragContrast(canvas, 0, -60);
    await expect
      .poll(async () => (await oct.projectionTransform())[0])
      .not.toBe(initial[0]);

    await page
      .locator('button[data-testid="control-button-Reset Views"]')
      .click();
    await oct.expectProjectionTransform(initial);
    await oct.setEnFaceWindow(1000, 500);
    const reset = await oct.projectionTransform();
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect
      .poll(async () => (await oct.projectionTransform())[0])
      .not.toBe(reset[0]);
    await octInteraction.expectProjectionPixel(81);

    await oct.toolButton('Pan').click();
    await oct.dragContrast(canvas, 55, 30);
    await oct.openEnFaceProjection();
    await oct.selectSetting('enface-projection-axis', 'Sagittal');
    await oct.waitForEnFaceReady();
    await page.keyboard.press('Escape');
    const center = await oct.enFaceScreenPoint(
      reference.size[1] / 2,
      reference.size[2] / 2
    );
    const geometry = await canvas.evaluate((element, screenPoint) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: screenPoint.x - (bounds.left + bounds.width / 2),
        y: screenPoint.y - (bounds.top + bounds.height / 2),
      };
    }, center);
    expect(geometry.x).toBeCloseTo(0, 2);
    expect(geometry.y).toBeCloseTo(0, 2);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('uses standard pan, zoom and windowing while following source B-scan navigation', async ({
    page,
    volview,
    scratch,
    oct,
    octInteraction,
  }) => {
    const canvas = page.locator(CANVAS).first();
    const sliceLine = page.locator(SLICE_LINE).first();
    await page.setViewportSize({ width: 1440, height: 900 });
    await octInteraction.openRetina(true, true);
    const originalWindow = await octInteraction.getOriginalWindow();
    expect(originalWindow.width).toBeCloseTo(
      reference.range[1] - reference.range[0],
      2
    );
    expect(originalWindow.level).toBeCloseTo(
      (reference.range[1] + reference.range[0]) / 2,
      2
    );
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU_PANEL)).toBeHidden();
    await octInteraction.expectStackedMaskWithoutSidebar();
    const viewport = await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const view = element
        .closest('[data-testid="enface-viewer"]')!
        .getBoundingClientRect();
      return {
        widthDifference: Math.abs(bounds.width - view.width),
        heightDifference: Math.abs(bounds.height - view.height),
      };
    });
    expect(viewport.widthDifference).toBeLessThan(2);
    expect(viewport.heightDifference).toBeLessThan(2);
    await volview.focusFirst2DView();
    await octInteraction.expectSliceLine();
    const horizontalDirection = await sliceLine.evaluate((element) => {
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
    const beforeKey = await volview.getFirst2DSlice();
    if (beforeKey === undefined)
      throw new Error('The original OCT view has no slice position');
    await volview.advanceSliceAndWait();
    expect(await volview.getFirst2DSlice()).toBeLessThan(beforeKey);
    await octInteraction.expectSliceLine();

    const sourceView = volview.views2D.first();
    await waitForTransitions(sourceView.locator('canvas'));
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const source = document.querySelector(
              'div[data-testid~="vtk-two-view"]'
            );
            const sourceCanvas = source?.querySelector('canvas');
            if (!sourceCanvas || !source) return false;
            const rect = sourceCanvas.getBoundingClientRect();
            const underPointer = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2
            );
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              underPointer === sourceCanvas &&
              document.querySelectorAll('.v-menu.v-overlay--active').length ===
                0
            );
          }),
        {
          message:
            'Expected a stable, unobscured source OCT canvas before native wheel input',
        }
      )
      .toBe(true);
    const sourceBounds = await sourceView.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const sourceLocation = { x: sourceBounds.x, y: sourceBounds.y };
    const sourceSize = {
      width: sourceBounds.width,
      height: sourceBounds.height,
    };
    const beforeWheel = await volview.getFirst2DSlice();
    const sourceHandle = page
      .locator('.vtk-container-wrapper .slice-slider-handle')
      .first();
    const beforeWheelHandleY = (await boxOf(sourceHandle)).y;
    const beforeWheelLineY = (await boxOf(sliceLine)).y;
    await page.mouse.move(
      Math.round(sourceLocation.x + sourceSize.width / 2),
      Math.round(sourceLocation.y + sourceSize.height / 2)
    );
    await page.mouse.wheel(0, 120);
    await expect.poll(volview.getFirst2DSlice).not.toBe(beforeWheel);
    await octInteraction.expectSliceLine();
    expect((await boxOf(sourceHandle)).y).toBeGreaterThan(beforeWheelHandleY);
    expect((await boxOf(sliceLine)).y).toBeGreaterThan(beforeWheelLineY);

    const slider = page.locator('.vtk-container-wrapper .slice-slider').first();
    const sliderBox = await boxOf(slider);
    const beforeSlider = await volview.getFirst2DSlice();
    const handleBox = await boxOf(sourceHandle);
    const beforeSliderLineY = (await boxOf(sliceLine)).y;
    const handleX = Math.round(handleBox.x + handleBox.width / 2);
    const handleY = Math.round(handleBox.y + handleBox.height / 2);
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(
      handleX,
      handleY + Math.round(sliderBox.height * 0.15)
    );
    await page.mouse.up();
    await expect.poll(volview.getFirst2DSlice).not.toBe(beforeSlider);
    await octInteraction.expectSliceLine();
    expect((await boxOf(sourceHandle)).y).toBeGreaterThan(handleBox.y);
    expect((await boxOf(sliceLine)).y).toBeGreaterThan(beforeSliderLineY);

    const projectionGeometry = page
      .locator('[data-testid="enface-slice-lines"] > g')
      .first();
    const beforePan = await projectionGeometry.getAttribute('transform');
    await oct.toolButton('Pan').click();
    await oct.dragContrast(canvas, 55, 30);
    await expect
      .poll(() => projectionGeometry.getAttribute('transform'))
      .not.toBe(beforePan);
    const beforeZoom = await boxOf(sliceLine);
    await oct.toolButton('Zoom').click();
    await oct.dragContrast(canvas, 0, -60);
    await expect
      .poll(async () => (await boxOf(sliceLine)).width)
      .not.toBe(beforeZoom.width);

    // Pointer input through the toolbar changes rendered pixels.
    const beforePixels = (await oct.enFaceAppearance()).image;
    await octInteraction.dragEnFaceContrast();
    expect(await page.locator(WINDOW_TOOL).getAttribute('class')).toContain(
      'tool-btn-selected'
    );
    expect((await oct.enFaceAppearance()).image).not.toBe(beforePixels);
    expect(await octInteraction.getOriginalWindow()).toEqual(originalWindow);
    expect(
      await page.locator('[data-testid="enface-window-width"]').count()
    ).toBe(0);
    expect(
      await page.locator('[data-testid="enface-window-level"]').count()
    ).toBe(0);
    // Return to the central retinal B-scan for the comparison screenshot.
    await page.mouse.move(
      Math.round(sliderBox.x + sliderBox.width / 2),
      Math.round(sliderBox.y + sliderBox.height / 2)
    );
    await page.mouse.down();
    await page.mouse.up();
    await octInteraction.expectSliceLine();
    // Select before capturing the comparison with a textured overlay.
    await oct.toolButton('Select').click();
    await oct.openEnFaceControls();
    await oct.setSegmentThreshold('Synthetic retinal layer', 31);
    await oct.expectHighlight(true);
    await octInteraction.expectSliceLine();
    await oct.expectControlsBesideSelector();
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await expect(
        page.locator('.Vue-Toastification__toast').first()
      ).toBeHidden();
      await page.screenshot({
        path: path.join(captureDirectory, 'retina-en-face-thickness.png'),
      });
    }
    await page.keyboard.press('Escape');
    const savedWindow = await oct.getEnFaceWindow();
    const saved = await volview.saveSession();
    if (captureDirectory)
      fs.copyFileSync(
        scratch.path(saved),
        path.join(captureDirectory, 'oct-saved-session.volview.zip')
      );
    await volview.open('?urls=[tmp/' + saved + ']');
    await volview.waitForViews();
    await expect(canvas).toBeVisible();
    await oct.expectHighlight(true);
    await oct.expectEnFaceSegmentShown('Synthetic retinal layer', '31');
    await octInteraction.expectSliceLine();
    expect(await oct.getEnFaceWindow()).toEqual(savedWindow);
    expect(await octInteraction.getOriginalWindow()).toEqual(originalWindow);
    await octInteraction.expectStackedMaskWithoutSidebar();
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
