import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectDisplayed } from '../pageobjects/volview.page';
import type { SegmentationUtils } from './segmentationTestUtils';

// The computed color as #rrggbb, alpha dropped.
const hexOf = (element: Locator, property: string) =>
  element.evaluate(
    (node, name) =>
      '#' +
      (
        getComputedStyle(node)
          .getPropertyValue(name)
          .match(/\d+(\.\d+)?/g) ?? []
      )
        .slice(0, 3)
        .map((channel) => Number(channel).toString(16).padStart(2, '0'))
        .join(''),
    property
  );

const segmentDotHex = async (segmentation: SegmentationUtils, name: string) =>
  hexOf(
    (await segmentation.segmentRow(name)).locator('.color-dot'),
    'background-color'
  );

// A row renders before its title does, so a name-less row is not yet a
// segment the caller can read.
const waitForSegmentCount = (
  segmentation: SegmentationUtils,
  expected: number,
  message: string
) =>
  expect
    .poll(
      async () => {
        const names = await segmentation.segmentNames();
        return (
          names.length === expected && names.every((name) => name.length > 0)
        );
      },
      { message }
    )
    .toBe(true);

test.describe('An annotation placed against no segment', () => {
  test('mints a ruler segment on its first endpoint after deleting the selection', async ({
    volview,
    annotation,
    segmentation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    await volview.selectTool('mdi-ruler');
    await segmentation.openAnnotationSegments();
    for (const name of await segmentation.segmentNames())
      await segmentation.deleteSegment(name);
    expect(await segmentation.segmentNames()).toEqual([]);

    await annotation.nudgeTo(centerX - 40, centerY);
    await annotation.pressAtPointer();

    await waitForSegmentCount(
      segmentation,
      1,
      'Starting a ruler with nothing selected should mint a segment'
    );
    const [name] = await segmentation.segmentNames();
    const segmentHex = await segmentDotHex(segmentation, name);
    await annotation.nudgeTo(centerX + 40, centerY);
    const line = axialView.locator('svg line').first();
    await expectDisplayed(line);
    expect(await hexOf(line, 'stroke')).toBe(segmentHex);

    await annotation.pressAtPointer();
    expect(await segmentation.segmentNames()).toEqual([name]);
    expect(await hexOf(line, 'stroke')).toBe(segmentHex);
  });

  test('mints one segment the rectangle and the polygon then share', async ({
    volview,
    annotation,
    segmentation,
  }) => {
    const { axialView, centerX, centerY } = await annotation.setupTest();
    await segmentation.openAnnotationSegments();
    expect(await segmentation.segmentNames()).toEqual([]);

    // The first corner is the gesture that mints, so the rubber band is drawn
    // in the segment's color rather than changing color once it lands.
    await volview.activateRectangle();
    await annotation.clickAt(centerX - 60, centerY - 60);

    await segmentation.openAnnotationSegments();
    await waitForSegmentCount(
      segmentation,
      1,
      'Starting a rectangle with nothing selected should mint a segment'
    );
    const [name] = await segmentation.segmentNames();
    const segmentHex = await segmentDotHex(segmentation, name);
    const rect = axialView.locator('svg rect').first();
    const whilePlacing = await hexOf(rect, 'stroke');
    expect(whilePlacing).toBe(segmentHex);

    await annotation.clickAt(centerX + 60, centerY + 60);
    expect(await hexOf(rect, 'stroke')).toBe(whilePlacing);

    await volview.selectTool('mdi-pentagon-outline');
    await annotation.drawSquare(centerX, centerY + 80, 40);
    const polyline = axialView.locator('svg polyline').first();
    await expect(
      polyline,
      'Expected the placed polygon to render'
    ).toBeAttached();
    expect(await hexOf(polyline, 'stroke')).toBe(segmentHex);

    await segmentation.openAnnotationSegments();
    await waitForSegmentCount(
      segmentation,
      1,
      'The polygon should join the minted segment, not mint a second one'
    );
  });
});
