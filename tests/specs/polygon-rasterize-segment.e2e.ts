import AppPage from '../pageobjects/volview.page';
import {
  clickAt,
  nudgeTo,
  rightPressAtPointer,
  setupTest,
} from './annotationTestUtils';
import {
  addLabel,
  labelColor,
  openAnnotationSegments,
  renameLabel,
  segmentColor,
  segmentNames,
  waitForNamedSegments,
} from './segmentationTestUtils';

const RASTERIZE_ITEM = '.v-list-item-title=Rasterize';

const drawSquare = async (cx: number, cy: number, half: number) => {
  await clickAt(cx - half, cy - half);
  await clickAt(cx + half, cy - half);
  await clickAt(cx + half, cy + half);
  await clickAt(cx - half, cy + half);
  await clickAt(cx - half, cy - half); // close
};

// The menu comes off the widget's own pick, so hover the handle first and press
// without moving.
const openPolygonMenuAt = (x: number, y: number) =>
  browser.waitUntil(
    async () => {
      await nudgeTo(x, y);
      await rightPressAtPointer();
      return $(RASTERIZE_ITEM).isDisplayed();
    },
    {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Right-clicking a polygon handle should open its menu',
    }
  );

describe('Polygon rasterize target', () => {
  it('rasterizes into a segment carrying the polygon label name and color', async () => {
    const { centerX, centerY } = await setupTest();
    const half = 60;

    // Paint a stroke first, so the image already holds a segment the polygon
    // must not borrow. Activating the tool alone creates nothing.
    await AppPage.activatePaint();
    const views2D = await AppPage.getViews2D();
    await AppPage.paintStrokeOnView(views2D[0]);
    await AppPage.selectTool('mdi-pentagon-outline');

    // The picker lists the shared registry, so the paint stroke's type is
    // already there and the new one is the second.
    await addLabel();
    await renameLabel('Segment 2', 'Lesion');
    const lesionColor = await labelColor('Lesion');

    await drawSquare(centerX, centerY, half);

    // Placing the polygon is itself an edit, so the label it carries becomes a
    // segment before anything rasterizes.
    await openAnnotationSegments();
    await waitForNamedSegments();
    expect(await segmentNames()).toEqual(['Segment 1', 'Lesion']);

    // The context menu belongs to a placed polygon, and the polygon tool keeps
    // a placing one that would swallow the right click.
    await AppPage.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(centerX + half, centerY - half);
    await $(RASTERIZE_ITEM).click();

    // Rasterizing lands in the polygon's own segment: it neither mints a
    // second one nor borrows the segment the paint stroke made.
    expect(await segmentNames()).toEqual(['Segment 1', 'Lesion']);
    expect(await segmentColor('Lesion')).toEqual(lesionColor);
  });

  it('rasterizes an unlabeled polygon into a default segment', async () => {
    const { centerX, centerY } = await setupTest();
    const half = 60;

    // No paint stroke and no added label, so the image holds no segment and the
    // polygon carries no label. Rasterize still has to work.
    await AppPage.selectTool('mdi-pentagon-outline');
    await drawSquare(centerX, centerY, half);

    await AppPage.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(centerX + half, centerY - half);
    await $(RASTERIZE_ITEM).click();

    await openAnnotationSegments();
    await waitForNamedSegments();
    await browser.waitUntil(async () => (await segmentNames()).length === 1, {
      timeoutMsg:
        'Rasterizing without a label should create one default segment',
    });
  });
});
