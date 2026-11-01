import { volViewPage } from '../pageobjects/volview.page';
import { CANVAS, PANEL, waitForEnFaceReady } from './octTestUtils';
import {
  expectSliceLine,
  openRetina,
  reference,
  registerOctTestHooks,
  SLICE_LINE,
} from './octInteractionTestUtils';

async function lineCoordinates() {
  return Promise.all(
    ['x1', 'x2', 'y1', 'y2'].map(async (attribute) => {
      const value = await $(SLICE_LINE).getAttribute(attribute);
      if (value === null)
        throw new Error('Missing reference-line ' + attribute);
      return Number(value);
    })
  );
}

describe('En face reference line visibility', () => {
  registerOctTestHooks();

  it('keeps source reference lines visible while the projection is maximized', async () => {
    await openRetina(false, true);
    await browser.keys('Escape');
    await $(PANEL).waitForDisplayed({ reverse: true });
    await $('button[data-testid^="control-button-Select "]').click();
    await volViewPage.focusFirst2DView();
    await expectSliceLine();
    const before = await lineCoordinates();
    await $(CANVAS).click();
    await $(CANVAS).waitForStable();
    await $(CANVAS).doubleClick();
    await expect($('div[data-testid~="vtk-two-view"]')).not.toExist();
    await waitForEnFaceReady();
    await expect($$(SLICE_LINE)).toBeElementsArrayOfSize(1);
    const tolerance = 64 * Number.EPSILON * Math.max(...reference.size);
    await browser.waitUntil(
      async () =>
        (await lineCoordinates()).every(
          (value, index) =>
            Number.isFinite(value) &&
            Math.abs(value - before[index]) <= tolerance
        ),
      { timeoutMsg: 'Expected unchanged source reference-line endpoints' }
    );
    await $(CANVAS).waitForStable();
    await $(CANVAS).doubleClick();
    await $('div[data-testid~="vtk-two-view"] canvas').waitForDisplayed();
    await expectSliceLine();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
