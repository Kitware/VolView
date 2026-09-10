import { volViewPage } from '../pageobjects/volview.page';
import { PROSTATEX_DATASET } from './configTestUtils';
import { downloadFile, openUrls } from './utils';
import {
  clickAt,
  nudgeTo,
  pressAtPointer,
  rightClickAt,
  setupTest,
  waitForCircleCount,
} from './annotationTestUtils';
import {
  addSegment,
  openAnnotationSegments,
  lockSegment,
  segmentRow,
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

  it('selects one segment on ruler activation and uses it for the placement', async () => {
    const { centerX, centerY } = await setupTest();

    await volViewPage.selectTool('mdi-ruler');
    await openAnnotationSegments();
    expect(await segmentNames()).toEqual(['Segment 1']);
    expect(await selectedSegmentName()).toEqual('Segment 1');

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

  it('hides rendered annotations with their segment and preserves individually hidden shapes', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    await volViewPage.activateRectangle();
    await clickAt(centerX - 60, centerY - 60);
    await clickAt(centerX + 60, centerY + 60);
    await volViewPage.selectTool('mdi-cursor-default');
    await waitForCircleCount(
      axialView,
      2,
      'Placed rectangle should render both handles'
    );
    await openAnnotationSegments();
    const row = await segmentRow('Segment 1');
    await row.$('button:has(i.mdi-eye)').click();
    await waitForCircleCount(
      axialView,
      0,
      'Hiding the segment should remove its rectangle widget'
    );

    // Removing the SVG alone would leave VTK handles pickable. The old handle
    // must not open its annotation menu after the segment is hidden.
    await rightClickAt(centerX - 60, centerY - 60);
    const menuTitles = await $$('.v-overlay--active .v-list-item-title').map(
      (title) => title.getText()
    );
    expect(menuTitles).not.toContain('Delete Annotation');
    await row.$('button:has(i.mdi-eye-off)').click();
    await waitForCircleCount(
      axialView,
      2,
      'Showing the segment should restore its rectangle'
    );

    await openSegmentShapes();
    await $(
      '[data-testid="segment-shape-row"] button i[class~="mdi-eye"]'
    ).click();
    await waitForCircleCount(
      axialView,
      0,
      'The child visibility control should hide the rectangle'
    );
    await $('[data-testid="toggle-segments-visible-button"]').click();
    await $('[data-testid="toggle-segments-visible-button"]').click();
    await waitForCircleCount(
      axialView,
      0,
      'Showing every segment must preserve a hidden child'
    );
    await $(
      '[data-testid="segment-shape-row"] button i[class~="mdi-eye-off"]'
    ).click();
    await waitForCircleCount(
      axialView,
      2,
      'Showing the child should restore the same rectangle'
    );
  });

  it('explains disabled controls and prevents the locked color button from opening the editor', async () => {
    await setupTest();
    await volViewPage.selectTool('mdi-ruler');
    await openAnnotationSegments();
    await lockSegment('Segment 1');
    const row = await segmentRow('Segment 1');
    const controls = [
      {
        button: row.$('[data-testid="segment-color-button"]'),
        reason: 'Unlock this segment to change its color',
      },
      {
        button: row.$('[data-testid="edit-segment-button"]'),
        reason: 'Unlock this segment to edit it',
      },
      {
        button: row.$('[data-testid="delete-segment-button"]'),
        reason: 'Unlock this segment to delete it',
      },
      {
        button: row.$('[data-testid="reveal-segment-button"]'),
        reason: 'This segment has nothing on this image',
      },
      {
        button: $('[data-testid="save-segments-button"]'),
        reason: 'Nothing is painted on this image yet',
      },
    ];
    for (const { button, reason } of controls) {
      expect(await button.isEnabled()).toBe(false);
      // Vuetify disables pointer events on the button, so hover its wrapper.
      await button.$('..').moveTo();
      await expect(
        $('.v-tooltip.v-overlay--active .v-overlay__content')
      ).toHaveText(reason);
    }
    const dot = row.$('[data-testid="segment-color-button"]');
    const location = await dot.getLocation();
    const size = await dot.getSize();
    await clickAt(location.x + size.width / 2, location.y + size.height / 2);
    expect(await $('div[role="dialog"]').isDisplayed()).toBe(false);
    expect(await segmentNames()).toEqual(['Segment 1']);

    await row.$('button i[class~="mdi-lock"]').click();
    await dot.click();
    await $('div[role="dialog"]').waitForDisplayed();
    await volViewPage.editLabelModalDoneButton.click();
    await $('div[role="dialog"]').waitForDisplayed({ reverse: true });
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
