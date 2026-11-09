import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import {
  clickAt,
  drawSquare,
  nudgeTo,
  pressAtPointer,
} from './annotationTestUtils';
import {
  VIEWER,
  canvasAppearance,
  chooseEnFaceProjection,
  enFacePixel,
  enFaceScreenPoint,
  openEnFaceControls,
  PANEL,
  setEnFaceSlab,
  toolButton,
  waitForEnFaceReady,
} from './octTestUtils';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import {
  openAnnotationSegments,
  openSegmentShapes,
  revealSegment,
  shapeRowTexts,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  makeTempDir,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

const STEM = 'enface-slice-annotations';
const SIZE = [32, 20, 24];
const SOURCE = 'div[data-testid~="vtk-two-view"]';
const SLICE = '[data-testid="enface-annotation-slice"]';
const SHAPE_ROW = '[data-testid="segment-shape-row"]';
const MARKS = [
  'svg line:not([data-testid="reference-line"])',
  '[data-testid="rectangle-tool-container"] rect',
  'svg polyline',
];

async function scene(permuted = false) {
  const axis = permuted ? 'Axial' : 'Coronal';
  const directory = makeTempDir(STEM);
  fs.writeFileSync(
    path.join(directory, 'source.nrrd'),
    createNrrdVolume({
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
    })
  );
  await writeManifestToFile(
    { layouts: { Annotations: [[axis.toLowerCase(), 'enface']] } },
    STEM + '.json'
  );
  await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
  await waitForEnFaceReady();
  await setReferenceLinesEnabled(true);
  await setEnFaceSlab(4, 9);
  await expect($(SLICE)).toHaveText(`Annotations: ${axis} slice 8`);
  await toolButton('Select').click();
  await openAnnotationSegments();
  await waitForModuleTransitions();
  return axis;
}

async function clickPoint(x: number, y: number) {
  const point = await enFaceScreenPoint(x, y);
  await clickAt(point.x, point.y);
}

async function visibleMarks() {
  return $(VIEWER).execute((viewer, selectors) => {
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
    return (selectors as string[]).map(
      (selector) =>
        Array.from(viewer.querySelectorAll(selector)).filter(visible).length
    );
  }, MARKS);
}

async function expectMarks(expected: number[]) {
  await browser
    .waitUntil(
      async () =>
        JSON.stringify(await visibleMarks()) === JSON.stringify(expected),
      {
        timeoutMsg:
          'Expected the saved annotations on the midpoint source slice',
      }
    )
    .catch(async (error: Error) => {
      error.message +=
        '; actual visible marks: ' + JSON.stringify(await visibleMarks());
      throw error;
    });
}

async function drawAnnotations() {
  await toolButton('Ruler').click();
  await clickPoint(8.5, 5.5);
  await clickPoint(20.5, 5.5);
  await toolButton('Rectangle').click();
  await clickPoint(5.5, 10.5);
  await clickPoint(12.5, 16.5);
  await toolButton('Polygon').click();
  const center = await enFaceScreenPoint(23.5, 14.5);
  await drawSquare(center.x, center.y, 20);
  await toolButton('Select').click();
  await expectMarks([1, 1, 1]);
}

async function expectPlacement(axis: string) {
  await openSegmentShapes();
  await expect($$(SHAPE_ROW)).toBeElementsArrayOfSize(3);
  const rows = await shapeRowTexts();
  expect(rows.every((text) => text.includes(axis + ' 8'))).toBe(true);
  const measurement = rows.flatMap((text) => {
    const match = text.match(/([\d.]+)mm/);
    return match ? [Number(match[1])] : [];
  });
  expect(measurement).toHaveLength(1);
  expect(measurement[0]).toBeCloseTo(4.8, 1);
}

async function sourceSlice(index: number) {
  const slider = $('.vtk-container-wrapper .slice-slider');
  await slider.waitForStable();
  const [position, size, handleSize] = await Promise.all([
    slider.getLocation(),
    slider.getSize(),
    slider.$('.slice-slider-handle').getSize(),
  ]);
  await clickAt(
    position.x + size.width / 2,
    position.y +
      handleSize.height / 2 +
      (size.height - handleSize.height) * (1 - index / (SIZE[1] - 1))
  );
  await expect($(SOURCE).$('.slice-label')).toHaveText(
    `Slice: ${index + 1}/${SIZE[1]}`
  );
}

async function expectPaintedSource(present: boolean) {
  const canvas = await $(SOURCE).$('canvas').getElement();
  await browser.waitUntil(
    async () => {
      const { coloredPixels } = await canvasAppearance(canvas);
      return present ? coloredPixels > 10 : coloredPixels === 0;
    },
    {
      timeoutMsg: `Expected source paint to be ${present ? 'visible' : 'absent'}`,
    }
  );
}

async function expectPaintedProjection(present: boolean) {
  await browser.waitUntil(
    async () => {
      const pixel = await enFacePixel(16, 12);
      const colored =
        Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 20;
      return colored === present;
    },
    {
      timeoutMsg: `Expected projected paint to be ${present ? 'visible' : 'absent'}`,
    }
  );
}

describe('En face source-slice annotations', () => {
  after(async () => setReferenceLinesEnabled(false));

  for (const permuted of [false, true]) {
    it(`draws and restores shapes on the nearest midpoint slice with ${permuted ? 'permuted' : 'identity'} source axes`, async () => {
      const axis = await scene(permuted);
      await drawAnnotations();
      await expectPlacement(axis);
      await setEnFaceSlab(2, 3);
      await expectMarks([0, 0, 0]);
      await $(SHAPE_ROW).$('[data-testid="reveal-shape-button"]').click();
      await expect($(SLICE)).toHaveText(`Annotations: ${axis} slice 8`);
      await expectMarks([1, 1, 1]);
      await setEnFaceSlab(4, 9);
      await expectMarks([1, 1, 1]);

      const saved = await volViewPage.saveSession();
      await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
      await volViewPage.open('?urls=[tmp/' + saved + ']');
      await waitForEnFaceReady();
      await expectPlacement(axis);
      await expectMarks([1, 1, 1]);
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }

  it('paints only the midpoint source slice with permuted axes', async () => {
    await scene(true);
    await toolButton('Paint').click();
    await openAnnotationSegments();
    const point = await enFaceScreenPoint(16.5, 12.5);
    await nudgeTo(point.x, point.y);
    await pressAtPointer();
    await toolButton('Select').click();
    await waitForSegmentContent('Segment 1');
    await expectPaintedProjection(true);
    await expect($('[data-testid="save-segments-button"]')).toBeEnabled();
    await setEnFaceSlab(0, 3);
    await expectPaintedProjection(false);
    await revealSegment('Segment 1');
    await expect($(SLICE)).toHaveText('Annotations: Axial slice 8');
    await expectPaintedProjection(true);
    await expect($(SOURCE).$('.slice-label')).toHaveText('Slice: 8/20');
    await expectPaintedSource(true);
    await sourceSlice(6);
    await expectPaintedSource(false);
    await sourceSlice(8);
    await expectPaintedSource(false);
    await sourceSlice(7);
    await expectPaintedSource(true);

    await toolButton('Paint').click();
    await openEnFaceControls();
    const footprintToggle = $(PANEL).$(
      '[data-testid="enface-footprints-toggle"]'
    );
    await footprintToggle.scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });
    await expect(footprintToggle.$('input')).toBeSelected();
    await footprintToggle.$('label').click();
    await expect(footprintToggle.$('input')).not.toBeSelected();
    await expectPaintedProjection(false);
    await browser.keys('Escape');
    await toolButton('Select').click();
    await expectPaintedProjection(false);
    await toolButton('Paint').click();
    await expectPaintedProjection(true);
    await toolButton('Select').click();

    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await openAnnotationSegments();
    await waitForSegmentContent('Segment 1');
    await expectPaintedProjection(true);
    await revealSegment('Segment 1');
    await expectPaintedSource(true);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('cancels unfinished placement when changing the projection axis at the same midpoint', async () => {
    await scene(true);
    await setEnFaceSlab(14, 18);
    await expect($(SLICE)).toHaveText('Annotations: Axial slice 17');
    await toolButton('Ruler').click();
    await clickPoint(8.5, 5.5);
    await chooseEnFaceProjection('enface-projection-axis', 'Coronal');
    await expect($(SLICE)).toHaveText('Annotations: Coronal slice 17');
    await clickPoint(8.5, 5.5);
    await toolButton('Select').click();
    await expectMarks([0, 0, 0]);
    await expect($$(SHAPE_ROW)).toBeElementsArrayOfSize(0);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
