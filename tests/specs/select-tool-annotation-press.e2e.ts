import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { clickAt, setupTest, waitForCircleCount } from './annotationTestUtils';

// One input source held across action chains, so the press lands exactly where
// the hover left the pointer. Releasing actions would reset it to the origin.
const HOVERING_MOUSE = 'hovering-mouse';
const hoveringMouse = () => browser.action('pointer', { id: HOVERING_MOUSE });

const INSTANT = 0;
const NUDGE_PX = 2;
const DRAG_MS = 200;
const DRAG_DY = 40;
const TOLERANCE_PX = 3;

// vtk.js reports the first move after an idle period as StartMouseMove, which
// the widget manager does not pick on, so land on (x, y) with a second move.
const nudgeTo = (x: number, y: number) =>
  hoveringMouse()
    .move({ duration: INSTANT, x: x + NUDGE_PX, y: y + NUDGE_PX })
    .move({ duration: INSTANT, x, y })
    .perform(true);

const pressAtPointer = () => hoveringMouse().down().up().perform(true);

const dragFromPointer = (x: number, y: number) =>
  hoveringMouse().down().move({ duration: DRAG_MS, x, y }).up().perform(true);

// The widget manager sets the hover cursor once its pick lands on an annotation
// and restores the default one once it lands on nothing.
const waitForViewCursor = (
  axialView: ChainablePromiseElement,
  cursor: string,
  timeoutMsg: string
) =>
  browser.waitUntil(
    async () => {
      const current = await axialView.$('div.view').getCSSProperty('cursor');
      return current.value === cursor;
    },
    { timeout: 5000, timeoutMsg }
  );

const getHandleCenters = async (axialView: ChainablePromiseElement) => {
  const centers: Array<{ x: number; y: number }> = [];
  for (const circle of await axialView.$$('svg circle')) {
    centers.push({
      x: Number(await circle.getAttribute('cx')),
      y: Number(await circle.getAttribute('cy')),
    });
  }
  return centers;
};

// BoundingRectangle.vue draws this around the selected annotation
const waitForSelection = (
  axialView: ChainablePromiseElement,
  timeoutMsg: string
) =>
  browser.waitUntil(
    async () => {
      const rects = await axialView.$$('svg rect[stroke="lightgray"]');
      return (await rects.length) === 1;
    },
    { timeout: 5000, timeoutMsg }
  );

const placeAnnotation = async (
  icon: string,
  points: Array<[number, number]>
) => {
  await AppPage.selectTool(icon);
  for (const [x, y] of points) {
    await clickAt(x, y);
  }
};

// Confirms the press landed on the annotation, then hovers empty space so the
// DOM reflects everything the press did before the handles are compared.
const settleAfterPress = async (
  axialView: ChainablePromiseElement,
  awayX: number,
  awayY: number
) => {
  await waitForSelection(axialView, 'Pressing the annotation should select it');
  await nudgeTo(awayX, awayY);
  await waitForViewCursor(
    axialView,
    'default',
    'Leaving the annotation should restore the default cursor'
  );
};

const expectHandlesUnmoved = (
  before: Array<{ x: number; y: number }>,
  after: Array<{ x: number; y: number }>
) => {
  expect(after.length).toBe(before.length);
  before.forEach((handle, index) => {
    expect(Math.abs(after[index].x - handle.x)).toBeLessThanOrEqual(
      TOLERANCE_PX
    );
    expect(Math.abs(after[index].y - handle.y)).toBeLessThanOrEqual(
      TOLERANCE_PX
    );
  });
};

const TOOL_CASES = [
  { tool: 'ruler', icon: 'mdi-ruler' },
  { tool: 'rectangle', icon: 'mdi-vector-square' },
];

// The select tool resolves its own pick on press. The annotation widgets read
// the widget manager's standing pick while handling that same press.
describe('Pressing an annotation with the select tool', () => {
  TOOL_CASES.forEach(({ tool, icon }) => {
    it(`drags the ${tool} handle without an application error`, async () => {
      const { axialView, centerX, centerY } = await setupTest();
      const handleX = Math.round(centerX - 60);
      const handleY = Math.round(centerY - 60);

      await placeAnnotation(icon, [
        [handleX, handleY],
        [centerX + 60, centerY + 60],
      ]);
      await waitForCircleCount(axialView, 2, `${tool} should have two handles`);
      const [before] = await getHandleCenters(axialView);

      await AppPage.selectTool('mdi-cursor-default');
      await nudgeTo(handleX, handleY);
      await waitForViewCursor(
        axialView,
        'pointer',
        'Hovering the handle should pick it'
      );
      await dragFromPointer(handleX, handleY + DRAG_DY);

      await browser.waitUntil(
        async () => {
          const [after] = await getHandleCenters(axialView);
          return Math.abs(after.y - before.y - DRAG_DY) <= TOLERANCE_PX;
        },
        {
          timeout: 5000,
          timeoutMsg: `The ${tool} handle should follow the drag`,
        }
      );
      const [after] = await getHandleCenters(axialView);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(await AppPage.getNotificationsCount()).toBe(0);
    });
  });

  it('keeps the ruler handles in place when its line is clicked', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    const midX = Math.round(centerX);
    const midY = Math.round(centerY);

    await placeAnnotation('mdi-ruler', [
      [midX - 60, midY - 60],
      [midX + 60, midY + 60],
    ]);
    await waitForCircleCount(axialView, 2, 'Ruler should have two handles');
    const before = await getHandleCenters(axialView);

    await AppPage.selectTool('mdi-cursor-default');
    await nudgeTo(midX, midY);
    await waitForViewCursor(
      axialView,
      'pointer',
      'Hovering the line should pick the ruler'
    );
    await pressAtPointer();
    await settleAfterPress(axialView, midX + 140, midY - 140);

    expectHandlesUnmoved(before, await getHandleCenters(axialView));
    expect(await AppPage.getNotificationsCount()).toBe(0);
  });

  // The polygon moves its active handle on mouse move, so a drag is what
  // would expose an unintended grab of the edge.
  it('keeps the polygon handles in place when its edge is dragged', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    const midX = Math.round(centerX);
    const topY = Math.round(centerY - 80);

    await placeAnnotation('mdi-pentagon-outline', [
      [midX - 80, topY],
      [midX + 80, topY],
      [midX, centerY + 80],
      [midX - 80, topY], // close
    ]);
    await waitForCircleCount(axialView, 3, 'Polygon should have three handles');
    const before = await getHandleCenters(axialView);

    await AppPage.selectTool('mdi-cursor-default');
    await nudgeTo(midX, topY);
    await waitForViewCursor(
      axialView,
      'pointer',
      'Hovering the edge should pick the polygon'
    );
    await dragFromPointer(midX, topY + DRAG_DY);
    await settleAfterPress(axialView, midX + 140, topY - 60);

    expectHandlesUnmoved(before, await getHandleCenters(axialView));
    expect(await AppPage.getNotificationsCount()).toBe(0);
  });
});
