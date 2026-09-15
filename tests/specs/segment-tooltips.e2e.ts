import type { ChainablePromiseElement } from 'webdriverio';
import { volViewPage } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from './configTestUtils';
import { moveTo } from './annotationTestUtils';
import {
  openAnnotationSegments,
  renameSegment,
  segmentRow,
  waitForSegmentContent,
} from './segmentationTestUtils';
import { openUrls } from './utils';

const descriptionOf = async (element: ChainablePromiseElement) => {
  const id = await element.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  return $(`[id="${id}"]`);
};

describe('Segment tooltips', () => {
  it('shows row descriptions on hover and explains locked controls on keyboard focus', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await volViewPage.activatePaint();
    const views = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views[0]);
    await openAnnotationSegments();
    await waitForSegmentContent('Segment 1');

    const name = 'A segment name that is longer than the available row width';
    await renameSegment('Segment 1', name);
    const row = await segmentRow(name);
    const title = await row.$('.v-list-item-title');
    await title.moveTo();
    const titleTooltip = await descriptionOf(title);
    await expect(titleTooltip).toBeDisplayed();
    await expect(titleTooltip).toHaveText(name);
    await moveTo(10, 10);
    await expect(titleTooltip).not.toBeDisplayed();

    const lock = await row.$('button[aria-label^="Lock "]');
    await lock.moveTo();
    const lockTooltip = await descriptionOf(lock);
    await expect(lockTooltip).toBeDisplayed();
    await expect(lockTooltip).toHaveText(
      'Lock. Painting over this segment shares its voxels instead of taking them.'
    );
    await lock.click();
    await moveTo(10, 10);

    await browser.keys(['Shift', 'Tab']);
    const edit = await row.$('[data-testid="edit-segment-button"]');
    const editActivator = await edit.$('..');
    await expect(edit).toBeDisabled();
    expect(
      await browser.execute(
        (element) => document.activeElement === element,
        await editActivator
      )
    ).toBe(true);
    const editTooltip = await descriptionOf(editActivator);
    await expect(editTooltip).toBeDisplayed();
    await expect(editTooltip).toHaveText('Unlock this segment to edit it');

    await browser.keys(['Shift', 'Tab']);
    await browser.keys(['Shift', 'Tab']);
    const color = await row.$('[data-testid="segment-color-button"]');
    const colorActivator = await color.$('..');
    await expect(color).toBeDisabled();
    expect(
      await browser.execute(
        (element) => document.activeElement === element,
        await colorActivator
      )
    ).toBe(true);
    const colorTooltip = await descriptionOf(colorActivator);
    await expect(colorTooltip).toBeDisplayed();
    await expect(colorTooltip).toHaveText(
      'Unlock this segment to change its color'
    );
  });
});
