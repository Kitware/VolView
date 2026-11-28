import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import {
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { AnnotationUtils } from './annotationTestUtils';
import {
  MENU_PANEL,
  VIEWER,
  canvasAppearance,
  type OctUtils,
} from './octTestUtils';
import type { ReferenceLinesUtils } from './referenceLinesTestUtils';
import type { SegmentationUtils } from './segmentationTestUtils';
import type { Utils } from './utils';

type Kit = {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  oct: OctUtils;
  annotation: AnnotationUtils;
  segmentation: SegmentationUtils;
  referenceLines: ReferenceLinesUtils;
};

const STEM = 'enface-slice-annotations';
const SIZE = [32, 20, 24];
const SOURCE = 'div[data-testid~="vtk-two-view"]';
const SHAPE_ROW = '[data-testid="segment-shape-row"]';
const MARKS = [
  'svg line:not([data-testid="reference-line"])',
  '[data-testid="rectangle-tool-container"] rect',
  'svg polyline',
];

async function scene(kit: Kit, permuted = false, images = ['source.nrrd']) {
  const { volview, utils, oct, segmentation, referenceLines } = kit;
  const axis = permuted ? 'Axial' : 'Coronal';
  const directory = utils.makeTempDir(STEM);
  const volume = createNrrdVolume({
    dimensions: SIZE,
    spacing: [0.4, 0.6, 0.7],
    origin: [19, -25, 7],
    direction: permuted
      ? [0, 1, 0, 0, 0, 1, 1, 0, 0]
      : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    scalars: Uint16Array.from(
      { length: SIZE.reduce((count, size) => count * size) },
      (_, index) => 50 + (index % 300)
    ),
  });
  images.forEach((name) =>
    fs.writeFileSync(path.join(directory, name), volume)
  );
  await utils.writeManifestToFile(
    { layouts: { Annotations: [[axis.toLowerCase(), 'enface']] } },
    STEM + '.json'
  );
  const urls = images.map((name) => `tmp/${STEM}/${name}`).join(',');
  await volview.open(`?urls=[tmp/${STEM}.json,${urls}]`);
  await oct.waitForEnFaceReady();
  await referenceLines.setReferenceLinesEnabled(true);
  await oct.setEnFaceSlab(4, 9);
  await oct.toolButton('Select').click();
  await segmentation.openAnnotationSegments();
  await utils.waitForModuleTransitions();
  return axis;
}

async function clickPoint(kit: Kit, x: number, y: number) {
  const point = await kit.oct.enFaceScreenPoint(x, y);
  await kit.annotation.clickAt(point.x, point.y);
}

async function visibleMarks(page: Page) {
  return page
    .locator(VIEWER)
    .first()
    .evaluate((viewer, selectors) => {
      const visible = (mark: Element) => {
        let ancestor: Element | null = mark;
        while (ancestor && ancestor !== viewer.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === 'none' || style.visibility === 'hidden')
            return false;
          ancestor = ancestor.parentElement;
        }
        const bounds = mark.getBoundingClientRect();
        return bounds.width > 0 || bounds.height > 0;
      };
      return selectors.map(
        (selector) =>
          Array.from(viewer.querySelectorAll(selector)).filter(visible).length
      );
    }, MARKS);
}

async function expectMarks(page: Page, expected: number[]) {
  await expect
    .poll(
      async () =>
        JSON.stringify(await visibleMarks(page)) === JSON.stringify(expected),
      {
        message: 'Expected the saved annotations within the En face slab',
      }
    )
    .toBe(true)
    .catch(async (error: Error) => {
      error.message +=
        '; actual visible marks: ' + JSON.stringify(await visibleMarks(page));
      throw error;
    });
}

async function drawAnnotations(kit: Kit) {
  const { oct, annotation } = kit;
  await oct.toolButton('Ruler').click();
  await clickPoint(kit, 8.5, 5.5);
  await clickPoint(kit, 20.5, 5.5);
  await oct.toolButton('Rectangle').click();
  await clickPoint(kit, 5.5, 10.5);
  await clickPoint(kit, 12.5, 16.5);
  await oct.toolButton('Polygon').click();
  const center = await oct.enFaceScreenPoint(23.5, 14.5);
  await annotation.drawSquare(center.x, center.y, 20);
  await oct.toolButton('Select').click();
  await expectMarks(kit.page, [1, 1, 1]);
}

async function expectPlacement(kit: Kit, axis: string) {
  await kit.segmentation.openSegmentShapes();
  await expect(kit.page.locator(SHAPE_ROW)).toHaveCount(3);
  const rows = await kit.segmentation.shapeRowTexts();
  expect(rows.every((text) => text.includes(axis + ' 8'))).toBe(true);
  const measurement = rows.flatMap((text) => {
    const match = text.match(/([\d.]+)mm/);
    return match ? [Number(match[1])] : [];
  });
  expect(measurement).toHaveLength(1);
  expect(measurement[0]).toBeCloseTo(4.8, 1);
}

async function sourceSlice(kit: Kit, index: number) {
  const slider = kit.page.locator('.vtk-container-wrapper .slice-slider');
  await waitForTransitions(slider);
  const [position, handle] = await Promise.all([
    slider.boundingBox(),
    slider.locator('.slice-slider-handle').boundingBox(),
  ]);
  if (!position || !handle) throw new Error('The slice slider is off screen');
  await kit.annotation.clickAt(
    position.x + position.width / 2,
    position.y +
      handle.height / 2 +
      (position.height - handle.height) * (1 - index / (SIZE[1] - 1))
  );
  await expect(kit.page.locator(SOURCE).locator('.slice-label')).toHaveText(
    `Slice: ${index + 1}/${SIZE[1]}`
  );
}

async function expectPaintedSource(page: Page, present: boolean) {
  const canvas = page.locator(SOURCE).locator('canvas').first();
  await expect
    .poll(
      async () => {
        const { coloredPixels } = await canvasAppearance(canvas);
        return present ? coloredPixels > 10 : coloredPixels === 0;
      },
      {
        message: `Expected source paint to be ${present ? 'visible' : 'absent'}`,
      }
    )
    .toBe(true);
}

async function expectPaintedProjection(oct: OctUtils, present: boolean) {
  await expect
    .poll(
      async () => {
        const pixel = await oct.enFacePixel(16, 12);
        const colored =
          Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 20;
        return colored === present;
      },
      {
        message: `Expected projected paint to be ${present ? 'visible' : 'absent'}`,
      }
    )
    .toBe(true);
}

test.describe('En face annotations', () => {
  for (const permuted of [false, true]) {
    test(`draws shapes on the midpoint slice and shows them across the slab with ${permuted ? 'permuted' : 'identity'} source axes`, async ({
      page,
      volview,
      utils,
      oct,
      annotation,
      segmentation,
      referenceLines,
    }) => {
      const kit = {
        page,
        volview,
        utils,
        oct,
        annotation,
        segmentation,
        referenceLines,
      };
      const revealShape = page
        .locator(SHAPE_ROW)
        .first()
        .locator('[data-testid="reveal-shape-button"]');
      const axis = await scene(kit, permuted);
      await drawAnnotations(kit);
      await expectPlacement(kit, axis);
      await oct.setEnFaceSlab(2, 3);
      await expectMarks(page, [0, 0, 0]);
      await revealShape.click();
      await expectMarks(page, [1, 1, 1]);
      // A slab holding the shapes away from its midpoint still shows them,
      // and revealing one leaves that slab where it is.
      await oct.setEnFaceSlab(6, 15);
      await expectMarks(page, [1, 1, 1]);
      await revealShape.click();
      await oct.openEnFaceControls();
      await oct.expectEnFaceProjectionSettings(axis, 6, 15);
      await page.keyboard.press('Escape');
      await expect(page.locator(MENU_PANEL)).toBeHidden();
      await oct.setEnFaceSlab(4, 9);
      await expectMarks(page, [1, 1, 1]);

      const saved = await volview.saveSession();
      await volview.open('?urls=[tmp/' + saved + ']');
      await oct.waitForEnFaceReady();
      await expectPlacement(kit, axis);
      await expectMarks(page, [1, 1, 1]);
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }

  test('paints through the slab depth with permuted axes', async ({
    page,
    volview,
    utils,
    oct,
    annotation,
    segmentation,
    referenceLines,
  }) => {
    const kit = {
      page,
      volview,
      utils,
      oct,
      annotation,
      segmentation,
      referenceLines,
    };
    await scene(kit, true);
    await oct.toolButton('Paint').click();
    await segmentation.openAnnotationSegments();
    const point = await oct.enFaceScreenPoint(16.5, 12.5);
    await annotation.nudgeTo(point.x, point.y);
    await annotation.pressAtPointer();
    await oct.toolButton('Select').click();
    await segmentation.waitForSegmentContent('Segment 1');
    await expectPaintedProjection(oct, true);
    await expect(
      page.locator('[data-testid="save-segments-button"]')
    ).toBeEnabled();
    await oct.setEnFaceSlab(0, 3);
    await expectPaintedProjection(oct, false);
    await segmentation.revealSegment('Segment 1');
    await expectPaintedProjection(oct, true);
    await expect(page.locator(SOURCE).locator('.slice-label')).toHaveText(
      'Slice: 7/20'
    );
    await expectPaintedSource(page, true);
    await sourceSlice(kit, 3);
    await expectPaintedSource(page, false);
    await sourceSlice(kit, 4);
    await expectPaintedSource(page, true);
    await sourceSlice(kit, 10);
    await expectPaintedSource(page, false);
    await sourceSlice(kit, 9);
    await expectPaintedSource(page, true);

    // The slab still crosses the stroke, but its midpoint slice is unpainted.
    await oct.setEnFaceSlab(8, 15);
    await expectPaintedProjection(oct, true);
    await oct.toolButton('Paint').click();
    await segmentation.addSegment();
    const selected = page.locator(
      '[data-testid="segment-list"] .item-row[aria-current="true"]'
    );
    await expect(selected).toHaveAttribute('aria-label', 'Segment 2');
    await page.locator('[data-testid="paint-eyedropper-button"]').click();
    await annotation.nudgeTo(point.x, point.y);
    await annotation.pressAtPointer();
    await expect(selected).toHaveAttribute('aria-label', 'Segment 1');

    // It passes over a segment this view's own eye hides.
    const sampleWith = async (shown: boolean, picked: string) => {
      await oct.openEnFaceControls();
      await oct.setSegmentShown('Segment 1', shown);
      await page.keyboard.press('Escape');
      await expect(page.locator(MENU_PANEL)).toBeHidden();
      await segmentation.selectSegment('Segment 2');
      await annotation.nudgeTo(point.x, point.y);
      await annotation.pressAtPointer();
      await expect(selected).toHaveAttribute('aria-label', picked);
    };
    await sampleWith(false, 'Segment 2');
    await sampleWith(true, 'Segment 1');
    await oct.toolButton('Select').click();

    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    await oct.waitForEnFaceReady();
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent('Segment 1');
    await expectPaintedProjection(oct, true);
    await segmentation.revealSegment('Segment 1');
    await expectPaintedSource(page, true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('shows the segment minted by a stroke begun beside the image', async ({
    page,
    volview,
    utils,
    oct,
    annotation,
    segmentation,
    referenceLines,
  }) => {
    await scene({
      page,
      volview,
      utils,
      oct,
      annotation,
      segmentation,
      referenceLines,
    });
    await oct.toolButton('Paint').click();
    // The image starts with no segment, so the stroke mints its own.
    // The smallest brush keeps the press clear of the image edge.
    const size = page.locator('[role="slider"][aria-label="Brush size"]');
    await expect(size).toBeVisible();
    await size.focus();
    await page.keyboard.press('Home');
    await expect(size).toHaveAttribute('aria-valuenow', '1');
    // Above the image, since the view controls sit beside its bottom edge.
    const outside = await oct.enFaceScreenPoint(16.5, 25.5);
    const inside = await oct.enFaceScreenPoint(16.5, 12.5);
    await annotation.nudgeTo(outside.x, outside.y);
    await annotation.dragPointerTo(inside.x, inside.y);
    await oct.toolButton('Select').click();
    await segmentation.waitForSegmentContent('Segment 1');
    await expectPaintedProjection(oct, true);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps painting after the En face view switches images', async ({
    page,
    volview,
    utils,
    oct,
    annotation,
    segmentation,
    referenceLines,
  }) => {
    await scene(
      { page, volview, utils, oct, annotation, segmentation, referenceLines },
      false,
      ['source.nrrd', 'second.nrrd']
    );
    // Either image may load first.
    await segmentation.clickImageCard('source.nrrd');
    await oct.waitForEnFaceReady();
    await oct.toolButton('Paint').click();
    const point = await oct.enFaceScreenPoint(16.5, 12.5);
    await annotation.nudgeTo(point.x, point.y);
    await annotation.pressAtPointer();
    await expectPaintedProjection(oct, true);
    await segmentation.clickImageCard('second.nrrd');
    await oct.waitForEnFaceReady();
    await expectPaintedProjection(oct, false);
    await annotation.nudgeTo(point.x, point.y);
    await annotation.pressAtPointer();
    await expectPaintedProjection(oct, true);
  });

  test('cancels unfinished placement when changing the projection axis at the same midpoint', async ({
    page,
    volview,
    utils,
    oct,
    annotation,
    segmentation,
    referenceLines,
  }) => {
    const kit = {
      page,
      volview,
      utils,
      oct,
      annotation,
      segmentation,
      referenceLines,
    };
    await scene(kit, true);
    await oct.setEnFaceSlab(14, 18);
    await oct.toolButton('Ruler').click();
    await clickPoint(kit, 8.5, 5.5);
    await oct.chooseEnFaceProjection('enface-projection-axis', 'Coronal');
    await clickPoint(kit, 8.5, 5.5);
    await oct.toolButton('Select').click();
    await expectMarks(page, [0, 0, 0]);
    await expect(page.locator(SHAPE_ROW)).toHaveCount(0);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
