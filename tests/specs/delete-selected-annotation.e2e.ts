import { type ChainablePromiseElement } from 'webdriverio';
import AppPage from '../pageobjects/volview.page';
import {
  clickAt,
  moveTo,
  setupTest,
  waitForCircleCount,
} from './annotationTestUtils';

// BoundingRectangle.vue draws this around the selected annotation
const getSelectionRectCount = async (axialView: ChainablePromiseElement) => {
  const rects = await axialView.$$('svg rect[stroke="lightgray"]');
  return rects.length;
};

const clickToSelect = async (
  axialView: ChainablePromiseElement,
  x: number,
  y: number
) => {
  await AppPage.selectTool('mdi-cursor-default');
  // The widget manager resolves what is under the cursor from a render pass
  // driven by mouse move, so hover first and retry until the click picks it up.
  await moveTo(x, y);
  await browser.waitUntil(
    async () => {
      await clickAt(x, y);
      return (await getSelectionRectCount(axialView)) === 1;
    },
    {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Clicking the annotation should draw a selection rectangle',
    }
  );
};

const pressDelete = () => browser.keys(['Delete']);

const placeRectangle = async (cx: number, cy: number, halfSize: number) => {
  await AppPage.selectTool('mdi-vector-square');
  await clickAt(cx - halfSize, cy - halfSize);
  await clickAt(cx + halfSize, cy + halfSize);
};

const TOOL_CASES = [
  {
    tool: 'ruler',
    icon: 'mdi-ruler',
    points: [
      [-60, -60],
      [60, 60],
    ],
    handles: 2,
  },
  {
    tool: 'rectangle',
    icon: 'mdi-vector-square',
    points: [
      [-80, -80],
      [80, 80],
    ],
    handles: 2,
  },
  {
    tool: 'polygon',
    icon: 'mdi-pentagon-outline',
    points: [
      [-80, -80],
      [80, -80],
      [80, 80],
      [-80, -80], // close
    ],
    handles: 3,
  },
];

describe('Delete key on a selected annotation', () => {
  TOOL_CASES.forEach(({ tool, icon, points, handles }) => {
    it(`deletes a selected ${tool}`, async () => {
      const { axialView, centerX, centerY } = await setupTest();

      await AppPage.selectTool(icon);
      for (const [dx, dy] of points) {
        await clickAt(centerX + dx, centerY + dy);
      }
      await waitForCircleCount(
        axialView,
        handles,
        `${tool} should have ${handles} handles`
      );

      const [firstX, firstY] = points[0];
      await clickToSelect(axialView, centerX + firstX, centerY + firstY);
      await pressDelete();

      await waitForCircleCount(
        axialView,
        0,
        `Delete should remove the ${tool}`
      );
      expect(await getSelectionRectCount(axialView)).toBe(0);
    });
  });

  // Checking a row in the annotations panel leaves focus on its checkbox, which
  // must not swallow the delete key
  it('deletes an annotation selected from the annotations panel', async () => {
    const { axialView, centerX, centerY } = await setupTest();

    await placeRectangle(centerX, centerY, 80);
    await waitForCircleCount(axialView, 2, 'Rectangle should have two handles');

    const annotationsTab = await AppPage.annotationsModuleTab;
    await annotationsTab.waitForClickable();
    await annotationsTab.click();

    const rowCheckbox = await $('.v-list-item .v-selection-control__input');
    await rowCheckbox.waitForClickable();
    await rowCheckbox.click();

    await pressDelete();

    await waitForCircleCount(
      axialView,
      0,
      'Delete should work while the panel checkbox holds focus'
    );
  });

  it('keeps unselected annotations', async () => {
    const { axialView, centerX, centerY } = await setupTest();

    await placeRectangle(centerX - 80, centerY - 80, 40);
    await placeRectangle(centerX + 80, centerY + 80, 40);
    await waitForCircleCount(axialView, 4, 'Two rectangles should be placed');

    await clickToSelect(axialView, centerX - 120, centerY - 120);
    await pressDelete();

    await waitForCircleCount(
      axialView,
      2,
      'Delete should remove only the selected rectangle'
    );
  });
});
