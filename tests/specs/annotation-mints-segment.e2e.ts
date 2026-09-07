import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { clickAt, setupTest } from './annotationTestUtils';
import {
  openAnnotationSegments,
  segmentNames,
  segmentRow,
} from './segmentationTestUtils';

const hexOf = async (element: ChainablePromiseElement, property: string) => {
  const { parsed } = await element.getCSSProperty(property);
  return parsed.hex;
};

const segmentDotHex = async (name: string) =>
  hexOf((await segmentRow(name)).$('.color-dot'), 'background-color');

// A row renders before its title does, so a name-less row is not yet a
// segment the caller can read.
const waitForSegmentCount = (expected: number, timeoutMsg: string) =>
  browser.waitUntil(
    async () => {
      const names = await segmentNames();
      return names.length === expected && names.every((name) => name.length);
    },
    { timeout: 10000, timeoutMsg }
  );

const drawSquare = async (cx: number, cy: number, half: number) => {
  await clickAt(cx - half, cy - half);
  await clickAt(cx + half, cy - half);
  await clickAt(cx + half, cy + half);
  await clickAt(cx - half, cy + half);
  await clickAt(cx - half, cy - half); // close
};

describe('An annotation placed against no segment', () => {
  it('mints one segment the rectangle and the polygon then share', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    await openAnnotationSegments();
    expect(await segmentNames()).toEqual([]);

    // The first corner is the gesture that mints, so the rubber band is drawn
    // in the segment's color rather than changing color once it lands.
    await AppPage.activateRectangle();
    await clickAt(centerX - 60, centerY - 60);

    await openAnnotationSegments();
    await waitForSegmentCount(
      1,
      'Starting a rectangle with nothing selected should mint a segment'
    );
    const [name] = await segmentNames();
    const segmentHex = await segmentDotHex(name);
    const whilePlacing = await hexOf(axialView.$('svg rect'), 'stroke');
    expect(whilePlacing).toBe(segmentHex);

    await clickAt(centerX + 60, centerY + 60);
    expect(await hexOf(axialView.$('svg rect'), 'stroke')).toBe(whilePlacing);

    await AppPage.selectTool('mdi-pentagon-outline');
    await drawSquare(centerX, centerY + 80, 40);
    await axialView.$('svg polyline').waitForExist({
      timeoutMsg: 'Expected the placed polygon to render',
    });
    expect(await hexOf(axialView.$('svg polyline'), 'stroke')).toBe(segmentHex);

    await openAnnotationSegments();
    await waitForSegmentCount(
      1,
      'The polygon should join the minted segment, not mint a second one'
    );
  });
});
