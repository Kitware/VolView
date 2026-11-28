import { test, expect } from '../fixtures';
import { ONE_CT_SLICE_DICOM } from '../datasets';

test.describe('Segment tooltips', () => {
  test('explains why creation is disabled and aligns the enabled create button', async ({
    volview,
    utils,
    segmentation,
  }) => {
    await volview.open();
    await segmentation.openAnnotationSegments();
    const disabledCreate = segmentation.createSegmentRow();
    await expect(disabledCreate).toBeDisabled();
    await utils.moveToElement(disabledCreate);
    const reason = await segmentation.tooltipOf(disabledCreate.locator('..'));
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText('Select an image to edit segments');

    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();
    const create = segmentation.createSegmentRow();
    const row = await segmentation.segmentRow('Segment 1');
    const left = (element: Element) => element.getBoundingClientRect().left;
    const right = (element: Element) => element.getBoundingClientRect().right;
    const remove = row.locator('[data-testid="delete-segment-button"]');
    const edges = [
      (await row.locator('.reorder-handle').evaluate(left)) -
        (await create.evaluate(left)),
      (await remove.evaluate(right)) -
        (await segmentation.copySegmentsRow().evaluate(right)),
    ];
    expect(Math.abs(edges[0])).toBeLessThan(1);
    expect(Math.abs(edges[1])).toBeLessThan(1);
  });

  test('shows row descriptions on hover and explains locked controls on keyboard focus', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent('Segment 1');

    const name = 'A segment name that is longer than the available row width';
    await segmentation.renameSegment('Segment 1', name);
    const row = await segmentation.segmentRow(name);
    const title = row.locator('.v-list-item-title');
    await utils.moveToElement(title);
    const titleTooltip = await segmentation.tooltipOf(title);
    await expect(titleTooltip).toBeVisible();
    await expect(titleTooltip).toHaveText(name);
    await annotation.moveTo(10, 10);
    await expect(titleTooltip).toBeHidden();

    const lock = row.locator('button[aria-label^="Lock "]');
    await utils.moveToElement(lock);
    const lockTooltip = await segmentation.tooltipOf(lock);
    await expect(lockTooltip).toBeVisible();
    await expect(lockTooltip).toHaveText(
      'Lock. Painting other segments goes around it, or overlaps it with Allow Overlap on.'
    );
    await lock.click();
    await annotation.moveTo(10, 10);

    const isFocused = (element: Element) => document.activeElement === element;
    await page.keyboard.press('Shift+Tab');
    const edit = row.locator('[data-testid="edit-segment-button"]');
    const editActivator = edit.locator('..');
    await expect(edit).toBeDisabled();
    expect(await editActivator.evaluate(isFocused)).toBe(true);
    const editTooltip = await segmentation.tooltipOf(editActivator);
    await expect(editTooltip).toBeVisible();
    await expect(editTooltip).toHaveText('Unlock this segment to edit it');

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    const color = row.locator('[data-testid="segment-color-button"]');
    const colorActivator = color.locator('..');
    await expect(color).toBeDisabled();
    expect(await colorActivator.evaluate(isFocused)).toBe(true);
    const colorTooltip = await segmentation.tooltipOf(colorActivator);
    await expect(colorTooltip).toBeVisible();
    await expect(colorTooltip).toHaveText(
      'Unlock this segment to change its color'
    );
  });
});
