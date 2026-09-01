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
  showFirstSegmentGroup,
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

    // Paint first, so the image already holds a segment the polygon must not
    // borrow.
    await AppPage.activatePaint();
    await AppPage.selectTool('mdi-pentagon-outline');

    await addLabel();
    await renameLabel('New Label', 'Lesion');
    const lesionColor = await labelColor('Lesion');

    await drawSquare(centerX, centerY, half);

    await openAnnotationSegments();
    await showFirstSegmentGroup();
    expect(await segmentNames()).toEqual(['Segment 1']);

    // The context menu belongs to a placed polygon, and the polygon tool keeps
    // a placing one that would swallow the right click.
    await AppPage.selectTool('mdi-cursor-default');
    await openPolygonMenuAt(centerX + half, centerY - half);
    await $(RASTERIZE_ITEM).click();

    await browser.waitUntil(
      async () => (await segmentNames()).includes('Lesion'),
      { timeoutMsg: 'Rasterizing should give the polygon label a labelmap' }
    );
    expect(await segmentNames()).toEqual(['Segment 1', 'Lesion']);
    expect(await segmentColor('Lesion')).toEqual(lesionColor);
  });
});
