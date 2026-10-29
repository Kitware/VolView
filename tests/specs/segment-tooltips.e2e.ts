import { volViewPage } from '../pageobjects/volview.page';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import { moveTo } from './annotationTestUtils';
import {
  openAnnotationSegments,
  addSegment,
  renameSegment,
  segmentRow,
  tooltipOf,
  waitForSegmentContent,
} from './segmentationTestUtils';
import { openUrls } from './utils';

describe('Segment tooltips', () => {
  it('explains why creation is disabled and aligns the enabled create row', async () => {
    await volViewPage.open();
    await openAnnotationSegments();
    const disabledCreate = $('[data-testid="segment-list"] .create-row');
    await expect(disabledCreate).toBeDisabled();
    await disabledCreate.moveTo();
    const reason = await tooltipOf(disabledCreate.$('..'));
    await expect(reason).toBeDisplayed();
    await expect(reason).toHaveText('Select an image to edit segments');

    await openUrls([ONE_CT_SLICE_DICOM]);
    await openAnnotationSegments();
    await addSegment();
    const create = $('[data-testid="segment-list"] .create-row');
    const row = await segmentRow('Segment 1');
    const handle = row.$('.reorder-handle');
    const icon = create.$('.create-icon');
    const positions = await browser.execute(
      (reorder, plus) => [
        reorder.getBoundingClientRect().left,
        plus.getBoundingClientRect().left,
      ],
      await handle,
      await icon
    );
    expect(Math.abs(positions[0] - positions[1])).toBeLessThan(1);
    await moveTo(10, 10);
    const background = await create.getCSSProperty('background-color');
    await create.moveTo();
    await browser.waitUntil(async () => {
      const hovered = await create.getCSSProperty('background-color');
      return hovered.value !== background.value;
    });
  });

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
    const titleTooltip = await tooltipOf(title);
    await expect(titleTooltip).toBeDisplayed();
    await expect(titleTooltip).toHaveText(name);
    await moveTo(10, 10);
    await expect(titleTooltip).not.toBeDisplayed();

    const lock = await row.$('button[aria-label^="Lock "]');
    await lock.moveTo();
    const lockTooltip = await tooltipOf(lock);
    await expect(lockTooltip).toBeDisplayed();
    await expect(lockTooltip).toHaveText(
      'Lock. Painting other segments goes around it, or overlaps it with Allow Overlap on.'
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
    const editTooltip = await tooltipOf(editActivator);
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
    const colorTooltip = await tooltipOf(colorActivator);
    await expect(colorTooltip).toBeDisplayed();
    await expect(colorTooltip).toHaveText(
      'Unlock this segment to change its color'
    );
  });
});
