import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { AnnotationUtils } from './annotationTestUtils';

const selectPolygonTool = (volview: VolViewPage) =>
  volview.selectTool('mdi-pentagon-outline');
const selectRectangleTool = (volview: VolViewPage) =>
  volview.selectTool('mdi-vector-square');

// High-level shape creation
const createSquarePolygon = async (
  { clickAt }: AnnotationUtils,
  centerX: number,
  centerY: number,
  halfSize: number
) => {
  const s = halfSize;
  await clickAt(centerX - s, centerY - s);
  await clickAt(centerX + s, centerY - s);
  await clickAt(centerX + s, centerY + s);
  await clickAt(centerX - s, centerY + s);
  await clickAt(centerX - s, centerY - s); // close
};

const createTrianglePolygon = async (
  { clickAt }: AnnotationUtils,
  centerX: number,
  centerY: number,
  offsets: [number, number][]
) => {
  for (const [dx, dy] of offsets) {
    await clickAt(centerX + dx, centerY + dy);
  }
  await clickAt(centerX + offsets[0][0], centerY + offsets[0][1]); // close
};

const startPolygonPoints = async (
  { clickAt }: AnnotationUtils,
  centerX: number,
  centerY: number,
  offsets: [number, number][]
) => {
  for (const [dx, dy] of offsets) {
    await clickAt(centerX + dx, centerY + dy);
  }
};

const createRectangle = async (
  { clickAt }: AnnotationUtils,
  centerX: number,
  centerY: number,
  halfSize: number
) => {
  await clickAt(centerX - halfSize, centerY - halfSize);
  await clickAt(centerX + halfSize, centerY + halfSize);
};

// Assertions
const getVisibleCircleCount = (axialView: Locator) =>
  axialView
    .locator('svg circle')
    .evaluateAll(
      (circles) =>
        circles.filter(
          (circle) => circle.getAttribute('visibility') !== 'hidden'
        ).length
    );

const expectRightClickRemovesOnePoint = async (
  annotation: AnnotationUtils,
  axialView: Locator,
  [x, y]: [number, number],
  message: string
) => {
  const countBefore = await annotation.getCircleCount(axialView);
  await annotation.rightClickAt(x, y);
  await annotation.waitForCircleCount(axialView, countBefore - 1, message);
};

test.describe('Polygon tool nested interaction', () => {
  test('should not show first polygon handles when hovering over it while placing second polygon', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    await selectPolygonTool(volview);

    await createSquarePolygon(annotation, centerX, centerY, 80);
    expect(await annotation.getCircleCount(axialView)).toBe(4);

    await startPolygonPoints(annotation, centerX, centerY, [
      [-40, -40],
      [40, -40],
    ]);

    await annotation.moveTo(centerX - 80, centerY - 80);

    await expect
      .poll(() => getVisibleCircleCount(axialView), {
        message:
          'First polygon handles should NOT be visible when hovering while placing second polygon',
      })
      .toBeLessThanOrEqual(2);
  });

  test('should allow right-click to remove points on third polygon inside existing one', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    await selectPolygonTool(volview);

    await createSquarePolygon(annotation, centerX, centerY, 100);
    await createTrianglePolygon(annotation, centerX, centerY, [
      [-60, -60],
      [-20, -60],
      [-40, -20],
    ]);
    await startPolygonPoints(annotation, centerX, centerY, [
      [20, 20],
      [60, 20],
    ]);

    await expectRightClickRemovesOnePoint(
      annotation,
      axialView,
      [centerX + 40, centerY + 40],
      'Right-click should remove one point from the third polygon'
    );
  });

  test('should allow right-click to remove points while placing new polygon inside existing one', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    await selectPolygonTool(volview);

    await createSquarePolygon(annotation, centerX, centerY, 80);
    await startPolygonPoints(annotation, centerX, centerY, [
      [-40, -40],
      [40, -40],
      [40, 40],
    ]);

    await expectRightClickRemovesOnePoint(
      annotation,
      axialView,
      [centerX, centerY],
      'Right-click should remove exactly one point from the placing polygon'
    );
  });

  test('should allow right-click to remove polygon points when placing inside a rectangle', async ({
    volview,
    annotation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();

    await selectRectangleTool(volview);
    await createRectangle(annotation, centerX, centerY, 80);

    await selectPolygonTool(volview);
    await startPolygonPoints(annotation, centerX, centerY, [
      [-40, -40],
      [40, -40],
      [40, 40],
    ]);

    await expectRightClickRemovesOnePoint(
      annotation,
      axialView,
      [centerX, centerY],
      'Right-click should remove one point from the polygon when placing inside a rectangle'
    );
  });
});
