import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';

// Low-level mouse helpers
const clickAt = async (x: number, y: number) => {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
};

const rightClickAt = async (x: number, y: number) => {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down({ button: 2 })
    .up({ button: 2 })
    .perform();
};

const moveTo = async (x: number, y: number) => {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .perform();
};

// Test setup
const setupTest = async () => {
  await AppPage.open(`?urls=${MINIMAL_DICOM.url}&names=${MINIMAL_DICOM.name}`);
  await AppPage.waitForViews();

  const views2D = await AppPage.getViews2D();
  const axialView = views2D[0];
  const canvas = await axialView.$('canvas');
  const location = await canvas.getLocation();
  const size = await canvas.getSize();

  return {
    axialView,
    centerX: location.x + size.width / 2,
    centerY: location.y + size.height / 2,
  };
};

// Tool selection
const selectPolygonTool = async () => {
  const btn = await $('button span i[class~=mdi-pentagon-outline]');
  await btn.click();
};

const selectRectangleTool = async () => {
  const btn = await $('button span i[class~=mdi-vector-square]');
  await btn.click();
};

// High-level shape creation
const createSquarePolygon = async (
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
  centerX: number,
  centerY: number,
  offsets: [number, number][]
) => {
  for (const [dx, dy] of offsets) {
    await clickAt(centerX + dx, centerY + dy);
  }
};

const createRectangle = async (
  centerX: number,
  centerY: number,
  halfSize: number
) => {
  await clickAt(centerX - halfSize, centerY - halfSize);
  await clickAt(centerX + halfSize, centerY + halfSize);
};

// Assertions
const getCircleCount = async (axialView: ChainablePromiseElement) => {
  const circles = await axialView.$$('svg circle');
  return circles.length;
};

const waitForPointRemoved = async (
  axialView: ChainablePromiseElement,
  countBefore: number,
  msg: string
) => {
  await browser.waitUntil(
    async () => (await getCircleCount(axialView)) === countBefore - 1,
    { timeout: 5000, timeoutMsg: msg }
  );
};

const getVisibleCircleCount = async (axialView: ChainablePromiseElement) => {
  const circles = await axialView.$$('svg circle');
  let count = 0;
  for (const circle of circles) {
    if ((await circle.getAttribute('visibility')) !== 'hidden') count++;
  }
  return count;
};

describe('Polygon tool nested interaction', () => {
  it('should not show first polygon handles when hovering over it while placing second polygon', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    await selectPolygonTool();

    await createSquarePolygon(centerX, centerY, 80);
    expect(await getCircleCount(axialView)).toBe(4);

    await startPolygonPoints(centerX, centerY, [
      [-40, -40],
      [40, -40],
    ]);

    await moveTo(centerX - 80, centerY - 80);

    await browser.waitUntil(
      async () => (await getVisibleCircleCount(axialView)) <= 2,
      {
        timeout: 3000,
        timeoutMsg:
          'First polygon handles should NOT be visible when hovering while placing second polygon',
      }
    );
  });

  it('should allow right-click to remove points on third polygon inside existing one', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    await selectPolygonTool();

    await createSquarePolygon(centerX, centerY, 100);
    await createTrianglePolygon(centerX, centerY, [
      [-60, -60],
      [-20, -60],
      [-40, -20],
    ]);
    await startPolygonPoints(centerX, centerY, [
      [20, 20],
      [60, 20],
    ]);

    const countBefore = await getCircleCount(axialView);
    await rightClickAt(centerX + 40, centerY + 40);
    await waitForPointRemoved(
      axialView,
      countBefore,
      'Right-click should remove one point from the third polygon'
    );
  });

  it('should allow right-click to remove points while placing new polygon inside existing one', async () => {
    const { axialView, centerX, centerY } = await setupTest();
    await selectPolygonTool();

    await createSquarePolygon(centerX, centerY, 80);
    await startPolygonPoints(centerX, centerY, [
      [-40, -40],
      [40, -40],
      [40, 40],
    ]);

    const countBefore = await getCircleCount(axialView);
    await rightClickAt(centerX, centerY);
    await waitForPointRemoved(
      axialView,
      countBefore,
      'Right-click should remove exactly one point from the placing polygon'
    );
  });

  it('should allow right-click to remove polygon points when placing inside a rectangle', async () => {
    const { axialView, centerX, centerY } = await setupTest();

    await selectRectangleTool();
    await createRectangle(centerX, centerY, 80);

    await selectPolygonTool();
    await startPolygonPoints(centerX, centerY, [
      [-40, -40],
      [40, -40],
      [40, 40],
    ]);

    const countBefore = await getCircleCount(axialView);
    await rightClickAt(centerX, centerY);
    await waitForPointRemoved(
      axialView,
      countBefore,
      'Right-click should remove one point from the polygon when placing inside a rectangle'
    );
  });
});
