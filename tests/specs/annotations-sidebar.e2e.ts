import { volViewPage } from '../pageobjects/volview.page';
import { PROSTATEX_DATASET } from './configTestUtils';
import { downloadFile, openUrls } from './utils';
import { nudgeTo, pressAtPointer, setupTest } from './annotationTestUtils';
import {
  addSegment,
  openAnnotationSegments,
  openSegmentShapes,
  renameSegment,
  revealSegment,
  segmentListTop,
  segmentNames,
  selectSegment,
  selectedSegmentName,
  shapeRowTexts,
  waitForNamedSegments,
} from './segmentationTestUtils';

// The sidebar sections are stacked rather than tabbed, so the Segments list is
// reachable whatever tool is active.
const DRAWING_TOOLS = [
  'mdi-vector-square',
  'mdi-pentagon-outline',
  'mdi-ruler',
  'mdi-brush',
];

describe('Annotations sidebar', () => {
  it('keeps the Segments list in place and selected across tool switches', async () => {
    await setupTest();

    await volViewPage.activatePaint();
    const views2D = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views2D[0]);

    await openAnnotationSegments();
    await waitForNamedSegments();
    await addSegment();
    await renameSegment('Segment 2', 'Lesion');
    await selectSegment('Lesion');

    const top = await segmentListTop();
    expect(await selectedSegmentName()).toEqual('Lesion');

    for (const icon of DRAWING_TOOLS) {
      await volViewPage.selectTool(icon);
      await $('[data-testid="segment-list"]').waitForDisplayed();
      expect(await segmentNames()).toEqual(['Segment 1', 'Lesion']);
      expect(await selectedSegmentName()).toEqual('Lesion');
      expect(await segmentListTop()).toEqual(top);
    }
  });

  it('mints a segment when a ruler is placed with nothing selected', async () => {
    const { centerX, centerY } = await setupTest();

    await volViewPage.selectTool('mdi-ruler');
    await openAnnotationSegments();
    expect(await segmentNames()).toEqual([]);

    // vtk.js ignores the first pointer move after an idle period, and the
    // sidebar work above is one, so each end is nudged onto and then pressed.
    await nudgeTo(centerX - 40, centerY);
    await pressAtPointer();
    await nudgeTo(centerX + 40, centerY);
    await pressAtPointer();

    await waitForNamedSegments();
    expect(await segmentNames()).toEqual(['Segment 1']);

    // The ruler is listed under the segment it named, with its length.
    await openSegmentShapes();
    const shapes = await shapeRowTexts();
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatch(/mm/);
  });
});

describe('Reveal Slice on a segment', () => {
  it('jumps the view back to a slice the segment covers', async () => {
    await downloadFile(PROSTATEX_DATASET.url, PROSTATEX_DATASET.name);
    await openUrls([PROSTATEX_DATASET]);

    await volViewPage.focusFirst2DView();
    await browser.waitUntil(
      async () => (await volViewPage.getFirst2DSlice()) !== null,
      { timeoutMsg: 'Slice overlay never appeared' }
    );
    const paintedSlice = await volViewPage.getFirst2DSlice();

    await volViewPage.activatePaint();
    const views2D = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views2D[0]);

    await openAnnotationSegments();
    await waitForNamedSegments();
    expect(await segmentNames()).toEqual(['Segment 1']);

    // Scroll away so revealing has somewhere to jump back from.
    await volViewPage.selectTool('mdi-cursor-default');
    await volViewPage.focusFirst2DView();
    await volViewPage.advanceSliceAndWait();
    await volViewPage.advanceSliceAndWait();
    expect(await volViewPage.getFirst2DSlice()).not.toEqual(paintedSlice);

    await revealSegment('Segment 1');

    await browser.waitUntil(
      async () => (await volViewPage.getFirst2DSlice()) === paintedSlice,
      { timeoutMsg: `Expected the view to return to slice ${paintedSlice}` }
    );
  });
});
