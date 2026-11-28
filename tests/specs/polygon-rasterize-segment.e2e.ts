import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { exactText } from '../pageobjects/volview.page';
import { CINE_US_DATASET } from '../datasets';
import type { Utils } from './utils';
import type { AnnotationUtils } from './annotationTestUtils';
import type { SegmentationUtils } from './segmentationTestUtils';

type Helpers = {
  page: Page;
  utils: Utils;
  annotation: AnnotationUtils;
  segmentation: SegmentationUtils;
};

const rasterizeItem = (page: Page) =>
  page.locator('.v-list-item-title', { hasText: exactText('Rasterize') });

const rasterizeMenuParts = (page: Page) => {
  const item = rasterizeItem(page).locator('..').locator('..');
  return { item, activator: item.locator('..') };
};

const expectDisabledRasterizeReason = async (
  { page, utils, segmentation }: Helpers,
  reason: string
) => {
  const { item, activator } = rasterizeMenuParts(page);
  expect(await item.getAttribute('class')).toContain('v-list-item--disabled');
  await utils.moveToElement(activator);
  const tooltip = await segmentation.tooltipOf(activator);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(reason);
};

const openPolygonMenuAt = async (
  { page, annotation }: Helpers,
  canvas: Locator,
  x: number,
  y: number
) => {
  // Every target is the square's top-right handle. Start outside its pickable
  // fill so the cursor transition confirms the handle's pick has completed.
  await annotation.nudgeTo(x + 20, y - 20);
  await expect(canvas).toHaveCSS('cursor', 'default');
  await annotation.nudgeTo(x, y);
  await expect(canvas).toHaveCSS('cursor', 'pointer');
  await annotation.rightPressAtPointer();
  await expect(rasterizeItem(page)).toBeVisible();
};

const setupAxialCanvas = async (annotation: AnnotationUtils) => {
  const { axialView, centerX, centerY } = await annotation.setupTest();
  return { canvas: axialView.locator('canvas'), centerX, centerY };
};

test.describe('Polygon rasterize target', () => {
  test('rasterizes into the segment the polygon was drawn with', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const helpers = { page, utils, annotation, segmentation };
    const { canvas, centerX, centerY } = await setupAxialCanvas(annotation);
    const half = 60;

    // Paint a stroke first, so the image already holds a segment the polygon
    // must not borrow. Selecting a tool creates no painted content.
    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());
    await volview.selectTool('mdi-pentagon-outline');

    // Polygon draws with the entry selected in the Segments list, so the paint
    // stroke's segment is already there and the new one is the second.
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.addSegment();
    await segmentation.renameSegment('Segment 2', 'Lesion');
    const lesionColor = await segmentation.segmentColor('Lesion');

    await annotation.drawSquare(centerX, centerY, half);

    expect(await segmentation.segmentNames()).toEqual(['Segment 1', 'Lesion']);

    // The context menu belongs to a placed polygon, and the polygon tool keeps
    // a placing one that would swallow the right click.
    await volview.selectTool('mdi-cursor-default');
    await segmentation.selectSegment('Segment 1');
    await openPolygonMenuAt(helpers, canvas, centerX + half, centerY - half);
    await expect(
      page.locator(
        '.v-overlay--active .v-list-item-title.v-list-item--disabled'
      )
    ).toHaveText('Lesion');
    await rasterizeItem(page).click();

    // Rasterizing lands in the polygon's own segment: it neither mints a
    // second one nor borrows the segment the paint stroke made.
    expect(await segmentation.segmentNames()).toEqual(['Segment 1', 'Lesion']);
    expect(await segmentation.segmentColor('Lesion')).toEqual(lesionColor);
    await volview.activatePaint();
    await page.locator('[data-testid="paint-eyedropper-button"]').click();
    await expect(canvas).toHaveCSS('cursor', /^url\(/);
    await annotation.nudgeTo(centerX, centerY);
    await annotation.pressAtPointer();
    await expect(
      page.locator(
        '[data-testid="segment-list"] .item-row[aria-current="true"]'
      )
    ).toHaveAttribute('aria-label', 'Lesion');
  });

  test('rasterizes a polygon drawn against an empty registry', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const helpers = { page, utils, annotation, segmentation };
    const { canvas, centerX, centerY } = await setupAxialCanvas(annotation);
    const half = 60;

    await volview.selectTool('mdi-pentagon-outline');
    await annotation.drawSquare(centerX, centerY, half);

    await segmentation.openAnnotationSegments();
    await expect(volview.saveSegmentsButtons.first()).toBeDisabled();
    await volview.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(helpers, canvas, centerX + half, centerY - half);
    await rasterizeItem(page).click();
    await expect(volview.saveSegmentsButtons.first()).toBeEnabled();

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await expect
      .poll(async () => (await segmentation.segmentNames()).length, {
        message: 'The polygon and its rasterized mask should share one segment',
      })
      .toBe(1);
  });

  test('explains a locked rasterize target on hover and keyboard focus', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const helpers = { page, utils, annotation, segmentation };
    const { canvas, centerX, centerY } = await setupAxialCanvas(annotation);
    const half = 60;
    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();
    await volview.selectTool('mdi-pentagon-outline');
    await annotation.drawSquare(centerX, centerY, half);
    await segmentation.lockSegment('Segment 1');

    await volview.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(helpers, canvas, centerX + half, centerY - half);
    let { item, activator } = rasterizeMenuParts(page);
    expect(await item.getAttribute('class')).toContain('v-list-item--disabled');

    await utils.moveToElement(activator);
    let tooltip = await segmentation.tooltipOf(activator);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(
      'Unlock this segment to rasterize into it'
    );

    await activator.focus();
    tooltip = await segmentation.tooltipOf(activator);
    await expect(tooltip).toBeVisible();

    await page.keyboard.press('Escape');
    const row = page.locator('[data-testid="segment-list"] .item-row').first();
    await row.locator('button i[class~="mdi-lock"]').click();
    await openPolygonMenuAt(helpers, canvas, centerX + half, centerY - half);
    ({ item, activator } = rasterizeMenuParts(page));
    expect(await item.getAttribute('class')).not.toContain(
      'v-list-item--disabled'
    );
    await item.click();
    await segmentation.waitForNamedSegments();
  });

  test('disables Rasterize for the locked first segment after an unnamed restore', async ({
    page,
    volview,
    utils,
    scratch,
    annotation,
    segmentation,
  }) => {
    const helpers = { page, utils, annotation, segmentation };
    const { centerX, centerY } = await annotation.setupTest();
    const half = 60;
    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();
    await volview.selectTool('mdi-pentagon-outline');
    await annotation.drawSquare(centerX, centerY, half);
    await segmentation.lockSegment('Segment 1');

    const savedName = await volview.saveSession();
    const { zip, manifest } =
      await utils.readSavedSessionWithoutSelection(savedName);
    delete manifest.tools.polygons.tools[0].segmentId;
    zip.file('manifest.json', JSON.stringify(manifest));

    const restoredName = 'restored-unnamed-locked-polygon.volview.zip';
    scratch.writeFile(
      restoredName,
      await zip.generateAsync({ type: 'nodebuffer' })
    );

    await utils.openVolViewPage(restoredName);
    const restoredView = volview.views2D.first();
    await expect(
      restoredView.locator('svg circle'),
      'The restored polygon should render all four handles'
    ).toHaveCount(4);
    const restoredCanvas = restoredView.locator('canvas');
    const box = await restoredCanvas.boundingBox();
    if (!box) throw new Error('The restored view has no canvas on screen');
    await volview.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(
      helpers,
      restoredCanvas,
      box.x + box.width / 2 + half,
      box.y + box.height / 2 - half
    );

    await expectDisabledRasterizeReason(
      helpers,
      'Unlock this segment to rasterize into it'
    );
  });

  test('keeps Rasterize visible on cine and explains why it is disabled', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const helpers = { page, utils, annotation, segmentation };
    await utils.openUrls([CINE_US_DATASET]);
    const view = volview.views2D.first();
    const canvas = view.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const half = 30;

    await volview.selectTool('mdi-pentagon-outline');
    await annotation.drawSquare(centerX, centerY, half);
    await volview.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(helpers, canvas, centerX + half, centerY - half);

    await expectDisabledRasterizeReason(
      helpers,
      'Rasterization is not supported for cine images'
    );
  });
});
